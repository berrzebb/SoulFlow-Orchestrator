import type { ServiceLike } from "../runtime/service.types.js";
import type { OrchestratorLlmRuntime } from "./orchestrator-llm.runtime.js";

/** OrchestratorLlmRuntime을 ServiceLike 인터페이스로 감싸는 어댑터. */
export class OrchestratorLlmServiceAdapter implements ServiceLike {
  readonly name = "orchestrator-llm-runtime";

  constructor(private readonly inner: OrchestratorLlmRuntime) {}

  async start(): Promise<void> {
    await this.inner.start();
  }

  async stop(): Promise<void> {
    await this.inner.stop();
  }

  async health_check(): Promise<{ ok: boolean; details?: Record<string, unknown> }> {
    const status = await this.inner.health_check();
    return {
      ok: status.running,
      details: {
        enabled: status.enabled,
        engine: status.engine,
        model: status.model,
        model_loaded: status.model_loaded,
        gpu_percent: status.gpu_percent,
      },
    };
  }
}
