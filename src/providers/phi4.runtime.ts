import { execFile, type ChildProcess, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec_file_async = promisify(execFile);

export type Phi4RuntimeEngine = "native" | "docker" | "podman";

export type Phi4RuntimeOptions = {
  enabled?: boolean;
  engine?: "auto" | Phi4RuntimeEngine;
  image?: string;
  container?: string;
  port?: number;
  model?: string;
  pull_model?: boolean;
  auto_stop?: boolean;
  api_base?: string;
  gpu_enabled?: boolean;
  gpu_args?: string[];
};

export type Phi4RuntimeStatus = {
  enabled: boolean;
  running: boolean;
  engine?: Phi4RuntimeEngine;
  container: string;
  image: string;
  port: number;
  model: string;
  api_base: string;
  last_error?: string;
  model_loaded?: boolean;
  gpu_percent?: number;
};

function to_engine(value: string | undefined): "auto" | Phi4RuntimeEngine {
  const v = String(value || "auto").toLowerCase();
  if (v === "native") return "native";
  if (v === "docker") return "docker";
  if (v === "podman") return "podman";
  return "auto";
}

/**
 * Ollama 기반 Phi4 런타임 매니저.
 *
 * 엔진 탐색 순서 (auto):
 *   1. API가 이미 응답 중이면 그대로 사용 (어떤 엔진이든)
 *   2. 네이티브 `ollama` 바이너리 → `ollama serve` 직접 실행
 *   3. Docker → 컨테이너
 *   4. Podman → 컨테이너
 *
 * 네이티브가 우선인 이유: 호스트 GPU 드라이버에 직접 접근하여
 * 컨테이너 대비 GPU 할당 실패 가능성이 현저히 낮음.
 */
export class Phi4RuntimeManager {
  readonly enabled: boolean;
  readonly engine_pref: "auto" | Phi4RuntimeEngine;
  readonly image: string;
  readonly container: string;
  readonly port: number;
  readonly model: string;
  readonly pull_model: boolean;
  readonly auto_stop: boolean;
  readonly api_base: string;
  readonly gpu_enabled: boolean;
  readonly gpu_args_override: string[] | null;

  private engine: Phi4RuntimeEngine | null = null;
  private running = false;
  private started_by_manager = false;
  private last_error = "";
  private native_process: ChildProcess | null = null;

  constructor(options?: Phi4RuntimeOptions) {
    this.enabled = options?.enabled ?? false;
    this.engine_pref = to_engine(options?.engine);
    this.image = options?.image || "ollama/ollama:latest";
    this.container = options?.container || "orchestrator-phi4";
    this.port = Math.max(1, Number(options?.port || 11434));
    this.model = options?.model || "phi4";
    this.pull_model = options?.pull_model ?? true;
    this.auto_stop = options?.auto_stop ?? false;
    this.api_base = options?.api_base || `http://127.0.0.1:${this.port}/v1`;
    this.gpu_enabled = options?.gpu_enabled ?? (String(process.env.PHI4_RUNTIME_GPU_ENABLED || "1") !== "0");
    this.gpu_args_override = Array.isArray(options?.gpu_args) && options.gpu_args.length > 0
      ? options.gpu_args
      : null;
  }

  get_status(): Phi4RuntimeStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      engine: this.engine || undefined,
      container: this.container,
      image: this.image,
      port: this.port,
      model: this.model,
      api_base: this.api_base,
      last_error: this.last_error || undefined,
      model_loaded: undefined,
    };
  }

  async start(): Promise<Phi4RuntimeStatus> {
    if (!this.enabled) return this.get_status();

    // 이미 API가 응답 중이면 엔진 탐색 생략
    if (await this.is_api_ready()) {
      this.running = true;
      return await this.health_check();
    }

    this.engine = await this.resolve_engine();
    if (!this.engine) {
      this.last_error = "no_runtime_engine_found";
      return this.get_status();
    }

    try {
      if (this.engine === "native") {
        await this.start_native();
      } else {
        await this.start_container();
      }

      await this.wait_api_ready(90_000);

      if (this.pull_model) {
        await this.pull_model_to_runtime();
      }

      // warm-up: 모델을 메모리/VRAM에 로드
      await this.warmup();

      this.running = await this.is_api_ready();
      if (!this.running) this.last_error = "phi4_runtime_not_ready_after_start";
      return await this.health_check();
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
      this.running = false;
      return this.get_status();
    }
  }

  async stop(): Promise<Phi4RuntimeStatus> {
    if (!this.enabled) return this.get_status();
    if (!this.auto_stop || !this.started_by_manager) return this.get_status();

    try {
      if (this.engine === "native" && this.native_process) {
        this.native_process.kill("SIGTERM");
        this.native_process = null;
      } else if (this.engine && this.engine !== "native") {
        await this.run_container_engine(["stop", this.container]);
      }
      this.running = false;
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
    }
    return this.get_status();
  }

  async health_check(): Promise<Phi4RuntimeStatus> {
    const base = this.get_status();
    const api_ready = await this.is_api_ready();
    const model_loaded = api_ready ? await this.is_model_loaded(this.model) : false;
    const gpu_percent = api_ready ? await this.get_gpu_percent() : undefined;
    return { ...base, running: api_ready, model_loaded, gpu_percent };
  }

  // ─── 엔진 탐색 ────────────────────────────────────

  private async resolve_engine(): Promise<Phi4RuntimeEngine | null> {
    if (this.engine_pref !== "auto") {
      const ok = this.engine_pref === "native"
        ? await this.check_native()
        : await this.check_container_engine(this.engine_pref);
      return ok ? this.engine_pref : null;
    }
    // auto: native → docker → podman
    if (await this.check_native()) return "native";
    if (await this.check_container_engine("docker")) return "docker";
    if (await this.check_container_engine("podman")) return "podman";
    return null;
  }

  private async check_native(): Promise<boolean> {
    try {
      await exec_file_async("ollama", ["--version"], { timeout: 8_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async check_container_engine(engine: "docker" | "podman"): Promise<boolean> {
    try {
      await exec_file_async(engine, ["--version"], { timeout: 8_000 });
      return true;
    } catch {
      return false;
    }
  }

  // ─── 네이티브 시작 ────────────────────────────────

  private async start_native(): Promise<void> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    env.OLLAMA_HOST = `0.0.0.0:${this.port}`;

    const child = spawn("ollama", ["serve"], {
      env,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    this.native_process = child;
    this.started_by_manager = true;
  }

  // ─── 컨테이너 시작 ───────────────────────────────

  private async start_container(): Promise<void> {
    const exists = await this.container_exists();
    if (!exists) {
      const gpu_args = this.build_gpu_args();
      await this.run_container_engine([
        "run", "-d", "--name", this.container,
        ...gpu_args,
        "-p", `${this.port}:11434`,
        "-v", `${this.container}-data:/root/.ollama`,
        this.image,
      ]);
      this.started_by_manager = true;
    } else {
      await this.run_container_engine(["start", this.container]).catch(() => undefined);
    }
  }

  private build_gpu_args(): string[] {
    if (!this.gpu_enabled || !this.engine || this.engine === "native") return [];
    if (this.gpu_args_override && this.gpu_args_override.length > 0) {
      return [...this.gpu_args_override];
    }
    const envRaw = String(process.env.PHI4_RUNTIME_GPU_ARGS || "").trim();
    if (envRaw) {
      return envRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    }
    if (this.engine === "docker") return ["--gpus", "all"];
    return ["--device", "nvidia.com/gpu=all"];
  }

  private async run_container_engine(args: string[]): Promise<void> {
    if (!this.engine || this.engine === "native") throw new Error("container_engine_not_selected");
    await exec_file_async(this.engine, args, { timeout: 180_000 });
  }

  private async container_exists(): Promise<boolean> {
    if (!this.engine || this.engine === "native") return false;
    try {
      const { stdout } = await exec_file_async(
        this.engine,
        ["ps", "-a", "--format", "{{.Names}}"],
        { timeout: 15_000 },
      );
      const lines = String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      return lines.includes(this.container);
    } catch {
      return false;
    }
  }

  // ─── 모델 관리 ────────────────────────────────────

  private async pull_model_to_runtime(): Promise<void> {
    if (this.engine === "native") {
      await exec_file_async("ollama", ["pull", this.model], { timeout: 300_000 }).catch(() => undefined);
    } else if (this.engine) {
      await this.run_container_engine(
        ["exec", this.container, "ollama", "pull", this.model],
      ).catch(() => undefined);
    }
  }

  /** 모델을 메모리/VRAM에 로드하여 cold start 방지. */
  private async warmup(): Promise<void> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    try {
      await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: "ping", stream: false, options: { num_predict: 1 } }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch { /* warm-up 실패는 무시 — 실제 요청 시 로드됨 */ }
  }

  // ─── API 상태 확인 ────────────────────────────────

  private async is_api_ready(): Promise<boolean> {
    try {
      const response = await fetch(`${this.api_base}/models`, { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async is_model_loaded(model: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.api_base}/models`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) return false;
      const data = (await response.json()) as Record<string, unknown>;
      const rows = Array.isArray(data.data) ? data.data : [];
      const needle = model.toLowerCase();
      return rows.some((row) => {
        if (!row || typeof row !== "object") return false;
        const id = String((row as Record<string, unknown>).id || "").toLowerCase();
        return id.includes(needle);
      });
    } catch {
      return false;
    }
  }

  /** /api/ps에서 현재 모델의 GPU 사용 비율 조회. */
  private async get_gpu_percent(): Promise<number | undefined> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    try {
      const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return undefined;
      const data = (await res.json()) as Record<string, unknown>;
      const models = Array.isArray(data.models) ? data.models : [];
      const needle = this.model.toLowerCase();
      for (const m of models) {
        if (!m || typeof m !== "object") continue;
        const rec = m as Record<string, unknown>;
        const name = String(rec.name || "").toLowerCase();
        if (!name.includes(needle)) continue;
        const size = Number(rec.size || 0);
        const vram = Number(rec.size_vram || 0);
        if (size <= 0) return undefined;
        return Math.round((vram / size) * 100);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async wait_api_ready(timeout_ms: number): Promise<void> {
    const deadline = Date.now() + timeout_ms;
    while (Date.now() < deadline) {
      if (await this.is_api_ready()) return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("phi4_api_ready_timeout");
  }
}
