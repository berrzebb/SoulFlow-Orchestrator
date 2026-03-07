import { error_message, sleep } from "../utils/common.js";
import { execFile, type ChildProcess, spawn } from "node:child_process";
import { promisify } from "node:util";
import { create_logger } from "../logger.js";

const log = create_logger("orchestrator-llm-runtime");

const exec_file_async = promisify(execFile);

export type OrchestratorLlmEngine = "native" | "docker" | "podman";

export type OrchestratorLlmOptions = {
  enabled?: boolean;
  engine?: "auto" | OrchestratorLlmEngine;
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

export type OrchestratorLlmStatus = {
  enabled: boolean;
  running: boolean;
  engine?: OrchestratorLlmEngine;
  container: string;
  image: string;
  port: number;
  model: string;
  api_base: string;
  last_error?: string;
  model_loaded?: boolean;
  gpu_percent?: number;
};

export type ModelInfo = {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  parameter_size?: string;
  quantization_level?: string;
};

export type RunningModelInfo = {
  name: string;
  size: number;
  size_vram: number;
  expires_at: string;
};

export type PullProgress = {
  status: string;
  completed?: number;
  total?: number;
};

function to_engine(value: string | undefined): "auto" | OrchestratorLlmEngine {
  const v = String(value || "auto").toLowerCase();
  if (v === "native") return "native";
  if (v === "docker") return "docker";
  if (v === "podman") return "podman";
  return "auto";
}

/**
 * Ollama 기반 오케스트레이터 LLM 런타임.
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
export class OrchestratorLlmRuntime {
  readonly enabled: boolean;
  readonly engine_pref: "auto" | OrchestratorLlmEngine;
  readonly image: string;
  readonly container: string;
  readonly port: number;
  model: string;
  readonly pull_model: boolean;
  readonly auto_stop: boolean;
  readonly api_base: string;
  readonly gpu_enabled: boolean;
  readonly gpu_args_override: string[] | null;

  private engine: OrchestratorLlmEngine | null = null;
  private running = false;
  private started_by_manager = false;
  private last_error = "";
  private native_process: ChildProcess | null = null;

  constructor(options?: OrchestratorLlmOptions) {
    this.enabled = options?.enabled ?? false;
    this.engine_pref = to_engine(options?.engine);
    this.image = options?.image || "ollama/ollama:latest";
    this.container = options?.container || "orchestrator-llm";
    this.port = Math.max(1, Number(options?.port || 11434));
    this.model = options?.model || "";
    this.pull_model = options?.pull_model ?? true;
    this.auto_stop = options?.auto_stop ?? false;
    this.api_base = options?.api_base || `http://127.0.0.1:${this.port}/v1`;
    this.gpu_enabled = options?.gpu_enabled ?? true;
    this.gpu_args_override = Array.isArray(options?.gpu_args) && options.gpu_args.length > 0
      ? options.gpu_args
      : null;
  }

  get_status(): OrchestratorLlmStatus {
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

  async start(): Promise<OrchestratorLlmStatus> {
    if (!this.enabled) return this.get_status();

    // API가 이미 응답 중이면 외부에서 관리되는 런타임 — 엔진 탐색 생략
    if (await this.is_api_ready()) {
      this.running = true;
      this.engine = this.engine ?? "native";
      return await this.health_check();
    }

    this.engine = await this.resolve_engine();
    if (!this.engine) {
      this.last_error = "no_runtime_engine_found";
      log.warn("no runtime engine found");
      return this.get_status();
    }

    log.info("starting", { engine: this.engine, model: this.model, port: this.port });

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
      if (!this.running) this.last_error = "orchestrator_llm_not_ready_after_start";
      log.info("started", { engine: this.engine, running: this.running });
      return await this.health_check();
    } catch (error) {
      this.last_error = error_message(error);
      this.running = false;
      log.error("start failed", { engine: this.engine, error: this.last_error });
      return this.get_status();
    }
  }

  async stop(): Promise<OrchestratorLlmStatus> {
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
      log.info("stopped", { engine: this.engine });
    } catch (error) {
      this.last_error = error_message(error);
      log.warn("stop failed", { error: this.last_error });
    }
    return this.get_status();
  }

  async health_check(): Promise<OrchestratorLlmStatus> {
    const base = this.get_status();
    const api_ready = await this.is_api_ready();
    const model_loaded = api_ready ? await this.is_model_loaded(this.model) : false;
    const gpu_percent = api_ready ? await this.get_gpu_percent() : undefined;
    return { ...base, running: api_ready, model_loaded, gpu_percent };
  }

  // ─── 엔진 탐색 ────────────────────────────────────

  private async resolve_engine(): Promise<OrchestratorLlmEngine | null> {
    if (this.engine_pref !== "auto") {
      const ok = this.engine_pref === "native"
        ? await this.check_native()
        : await this.check_container_engine(this.engine_pref);
      if (ok) return this.engine_pref;
      // CLI 바이너리 못 찾았지만 API가 응답 중이면 외부 관리 런타임
      if (await this.is_api_ready()) return this.engine_pref;
      return null;
    }
    // auto: native → docker → podman → API fallback
    if (await this.check_native()) return "native";
    if (await this.check_container_engine("docker")) return "docker";
    if (await this.check_container_engine("podman")) return "podman";
    // CLI 바이너리 못 찾았지만 API가 응답 중이면 외부 관리 런타임
    if (await this.is_api_ready()) return "native";
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
    // gpu_args_override가 없으면 엔진 기본값 사용
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

  // ─── 모델 관리 (public) ─────────────────────────────

  /** 설치된 모델 목록 조회 (GET /api/tags). */
  async list_models(): Promise<ModelInfo[]> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return [];
      const data = (await res.json()) as Record<string, unknown>;
      const models = Array.isArray(data.models) ? data.models : [];
      return models.map((m) => {
        const rec = (m && typeof m === "object") ? m as Record<string, unknown> : {};
        const details = (rec.details && typeof rec.details === "object") ? rec.details as Record<string, unknown> : {};
        return {
          name: String(rec.name || ""),
          size: Number(rec.size || 0),
          modified_at: String(rec.modified_at || ""),
          digest: String(rec.digest || ""),
          parameter_size: details.parameter_size ? String(details.parameter_size) : undefined,
          quantization_level: details.quantization_level ? String(details.quantization_level) : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  /** 모델 pull (POST /api/pull). non-streaming 단건 응답. */
  async pull_model_by_name(name: string): Promise<PullProgress> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    try {
      const res = await fetch(`${base}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, stream: false }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) return { status: `error_${res.status}` };
      const data = (await res.json()) as Record<string, unknown>;
      if (data.error) return { status: `error: ${String(data.error)}` };
      return {
        status: String(data.status || "unknown"),
        completed: data.completed != null ? Number(data.completed) : undefined,
        total: data.total != null ? Number(data.total) : undefined,
      };
    } catch (error) {
      return { status: `error: ${error_message(error)}` };
    }
  }

  /**
   * 모델 pull (스트리밍). Ollama NDJSON 스트림을 AsyncGenerator로 노출.
   * 각 chunk는 PullProgress 형태. 호출자가 SSE 등으로 변환.
   */
  async *pull_model_stream(name: string): AsyncGenerator<PullProgress> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    const res = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
      signal: AbortSignal.timeout(1_800_000),
    });
    if (!res.ok) {
      yield { status: `error_${res.status}` };
      return;
    }
    if (!res.body) {
      yield { status: "error_no_body" };
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as Record<string, unknown>;
          if (data.error) {
            yield { status: `error: ${String(data.error)}` };
            return;
          }
          yield {
            status: String(data.status || "unknown"),
            completed: data.completed != null ? Number(data.completed) : undefined,
            total: data.total != null ? Number(data.total) : undefined,
          };
        } catch { /* malformed line skip */ }
      }
    }
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer.trim()) as Record<string, unknown>;
        if (data.error) {
          yield { status: `error: ${String(data.error)}` };
          return;
        }
        yield {
          status: String(data.status || "done"),
          completed: data.completed != null ? Number(data.completed) : undefined,
          total: data.total != null ? Number(data.total) : undefined,
        };
      } catch { /* ignore */ }
    }
  }

  /** 모델 삭제 (DELETE /api/delete). */
  async delete_model(name: string): Promise<boolean> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    try {
      const res = await fetch(`${base}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(30_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** 현재 VRAM에 로드된 모델 조회 (GET /api/ps). */
  async list_running(): Promise<RunningModelInfo[]> {
    const base = this.api_base.replace(/\/v1\/?$/, "");
    try {
      const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return [];
      const data = (await res.json()) as Record<string, unknown>;
      const models = Array.isArray(data.models) ? data.models : [];
      return models.map((m) => {
        const rec = (m && typeof m === "object") ? m as Record<string, unknown> : {};
        return {
          name: String(rec.name || ""),
          size: Number(rec.size || 0),
          size_vram: Number(rec.size_vram || 0),
          expires_at: String(rec.expires_at || ""),
        };
      });
    } catch {
      return [];
    }
  }

  /** 활성 모델을 변경하고 warmup으로 VRAM에 로드. */
  async switch_model(name: string): Promise<OrchestratorLlmStatus> {
    this.model = name;
    await this.warmup();
    return this.get_status();
  }

  // ─── 모델 관리 (internal) ──────────────────────────

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
      await sleep(1500);
    }
    throw new Error("orchestrator_llm_api_ready_timeout");
  }
}
