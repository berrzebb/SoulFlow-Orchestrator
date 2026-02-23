import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec_file_async = promisify(execFile);

export type Phi4RuntimeEngine = "docker" | "podman";

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
};

function to_engine(value: string | undefined): "auto" | Phi4RuntimeEngine {
  const v = String(value || "auto").toLowerCase();
  if (v === "docker") return "docker";
  if (v === "podman") return "podman";
  return "auto";
}

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

    if (await this.is_api_ready()) {
      this.running = true;
      return this.get_status();
    }

    this.engine = await this.resolve_engine();
    if (!this.engine) {
      this.last_error = "no_container_engine_found";
      return this.get_status();
    }

    try {
      const exists = await this.container_exists();
      if (!exists) {
        const gpu_args = this.build_gpu_args();
        await this.run_engine([
          "run",
          "-d",
          "--name",
          this.container,
          ...gpu_args,
          "-p",
          `${this.port}:11434`,
          "-v",
          `${this.container}-data:/root/.ollama`,
          this.image,
        ]);
        this.started_by_manager = true;
      } else {
        await this.run_engine(["start", this.container]).catch(() => undefined);
      }

      await this.wait_api_ready(90_000);

      if (this.pull_model) {
        await this.run_engine(["exec", this.container, "ollama", "pull", this.model]).catch(() => undefined);
      }

      this.running = await this.is_api_ready();
      if (!this.running) this.last_error = "phi4_runtime_not_ready_after_start";
      return this.health_check();
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
      this.running = false;
      return this.get_status();
    }
  }

  async stop(): Promise<Phi4RuntimeStatus> {
    if (!this.enabled) return this.get_status();
    if (!this.auto_stop || !this.started_by_manager || !this.engine) return this.get_status();
    try {
      await this.run_engine(["stop", this.container]);
      this.running = false;
    } catch (error) {
      this.last_error = error instanceof Error ? error.message : String(error);
    }
    return this.get_status();
  }

  async health_check(): Promise<Phi4RuntimeStatus> {
    const base = this.get_status();
    const model_loaded = await this.is_model_loaded(this.model);
    return {
      ...base,
      running: await this.is_api_ready(),
      model_loaded,
    };
  }

  private async resolve_engine(): Promise<Phi4RuntimeEngine | null> {
    if (this.engine_pref === "docker" || this.engine_pref === "podman") {
      const ok = await this.check_engine(this.engine_pref);
      return ok ? this.engine_pref : null;
    }
    if (await this.check_engine("docker")) return "docker";
    if (await this.check_engine("podman")) return "podman";
    return null;
  }

  private build_gpu_args(): string[] {
    if (!this.gpu_enabled || !this.engine) return [];
    if (this.gpu_args_override && this.gpu_args_override.length > 0) {
      return [...this.gpu_args_override];
    }
    const envRaw = String(process.env.PHI4_RUNTIME_GPU_ARGS || "").trim();
    if (envRaw) {
      return envRaw
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (this.engine === "docker") {
      return ["--gpus", "all"];
    }
    // Podman + NVIDIA toolkit commonly supports this device syntax.
    return ["--device", "nvidia.com/gpu=all"];
  }

  private async check_engine(engine: Phi4RuntimeEngine): Promise<boolean> {
    try {
      await exec_file_async(engine, ["--version"], { timeout: 8_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async run_engine(args: string[]): Promise<void> {
    if (!this.engine) throw new Error("container_engine_not_selected");
    await exec_file_async(this.engine, args, { timeout: 180_000 });
  }

  private async container_exists(): Promise<boolean> {
    if (!this.engine) return false;
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

  private async is_api_ready(): Promise<boolean> {
    try {
      const response = await fetch(`${this.api_base}/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async is_model_loaded(model: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.api_base}/models`);
      if (!response.ok) return false;
      const data = (await response.json()) as Record<string, unknown>;
      const rows = Array.isArray(data.data) ? data.data : [];
      const needle = model.toLowerCase();
      return rows.some((row) => {
        if (!row || typeof row !== "object") return false;
        const rec = row as Record<string, unknown>;
        const id = String(rec.id || "").toLowerCase();
        return id.includes(needle);
      });
    } catch {
      return false;
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
