import type { ProviderRegistry } from "../providers/service.js";
import { CircuitBreaker } from "../providers/circuit-breaker.js";
import type { ProviderId } from "../providers/types.js";
import type { AgentBackend, AgentBackendId, AgentRunOptions, AgentRunResult, BackendCapabilities } from "./agent.types.js";
import type { AgentSessionStore } from "./agent-session-store.js";
import type { Logger } from "../logger.js";

export type AgentBackendConfig = {
  /** claude 실행에 사용할 백엔드. */
  claude_backend: "claude_cli" | "claude_sdk";
  /** codex 실행에 사용할 백엔드. */
  codex_backend: "codex_cli" | "codex_appserver";
};

const DEFAULT_CONFIG: AgentBackendConfig = {
  claude_backend: "claude_cli",
  codex_backend: "codex_cli",
};

/** 동일 계열 fallback 쌍 정의. */
const FALLBACK_MAP: Partial<Record<AgentBackendId, AgentBackendId>> = {
  claude_sdk: "claude_cli",
  codex_appserver: "codex_cli",
};

/**
 * AgentBackend를 관리하고 ProviderRegistry를 래핑하는 통합 레지스트리.
 * phi4/openrouter 같은 API 프로바이더는 기존 ProviderRegistry 경유.
 */
export class AgentBackendRegistry {
  private readonly backends = new Map<AgentBackendId, AgentBackend>();
  private readonly breakers = new Map<AgentBackendId, CircuitBreaker>();
  private readonly provider_registry: ProviderRegistry;
  private readonly config: AgentBackendConfig;
  private readonly session_store: AgentSessionStore | null;
  private readonly logger: Logger | null;

  constructor(deps: {
    provider_registry: ProviderRegistry;
    backends: AgentBackend[];
    config?: AgentBackendConfig;
    session_store?: AgentSessionStore | null;
    logger?: Logger | null;
  }) {
    this.provider_registry = deps.provider_registry;
    this.config = deps.config || DEFAULT_CONFIG;
    this.session_store = deps.session_store || null;
    this.logger = deps.logger || null;
    for (const backend of deps.backends) {
      this.backends.set(backend.id, backend);
      this.breakers.set(backend.id, new CircuitBreaker());
    }
  }

  /** 등록된 모든 백엔드 ID 목록. */
  list_backends(): AgentBackendId[] {
    return [...this.backends.keys()];
  }

  /** 특정 백엔드 인스턴스 조회. */
  get_backend(id: AgentBackendId): AgentBackend | null {
    return this.backends.get(id) || null;
  }

  /** ProviderId(claude_code/chatgpt)를 설정된 AgentBackendId로 해석. */
  resolve_backend_id(provider_id: ProviderId): AgentBackendId {
    if (provider_id === "claude_code") return this.config.claude_backend;
    if (provider_id === "chatgpt") return this.config.codex_backend;
    // phi4_local, openrouter → CLI fallback (직접 사용하지 않지만 안전 처리)
    return this.config.codex_backend;
  }

  /** ProviderId로 AgentBackend 인스턴스 조회. */
  resolve_backend(provider_id: ProviderId): AgentBackend | null {
    const id = this.resolve_backend_id(provider_id);
    return this.backends.get(id) || null;
  }

  /** circuit breaker + health scorer 적용하여 실행. circuit open 시 fallback 시도. */
  async run(backend_id: AgentBackendId, options: AgentRunOptions): Promise<AgentRunResult> {
    const backend = this.backends.get(backend_id);
    if (!backend) throw new Error(`agent_backend_not_found:${backend_id}`);

    if (!backend.is_available()) {
      return this._try_fallback(backend_id, options, `agent_backend_unavailable:${backend_id}`);
    }

    const breaker = this.breakers.get(backend_id);
    if (breaker && !breaker.try_acquire()) {
      return this._try_fallback(backend_id, options, `circuit_open:${backend_id}`);
    }

    const scorer = this.provider_registry.get_health_scorer();
    const start = Date.now();

    try {
      const result = await backend.run(options);
      const is_error = result.finish_reason === "error";
      if (is_error) {
        breaker?.record_failure();
      } else {
        breaker?.record_success();
      }
      scorer.record(backend_id, { ok: !is_error, latency_ms: Date.now() - start });

      // 세션 자동 영속화
      if (result.session && this.session_store) {
        try {
          this.session_store.save(result.session, { task_id: options.task_id, metadata: result.metadata });
        } catch { /* 영속화 실패는 실행 결과에 영향 없음 */ }
      }

      return result;
    } catch (error) {
      breaker?.record_failure();
      scorer.record(backend_id, { ok: false, latency_ms: Date.now() - start });
      return this._try_fallback(backend_id, options, error instanceof Error ? error.message : String(error));
    }
  }

  /** fallback 백엔드로 재시도. 없으면 원래 에러를 throw. */
  private async _try_fallback(
    primary_id: AgentBackendId,
    options: AgentRunOptions,
    reason: string,
  ): Promise<AgentRunResult> {
    const fallback_id = FALLBACK_MAP[primary_id];
    const fallback = fallback_id ? this.backends.get(fallback_id) : undefined;
    if (!fallback?.is_available()) {
      throw new Error(reason);
    }

    this.logger?.warn("backend_fallback", {
      primary: primary_id,
      fallback: fallback_id,
      reason,
      capability_diff: _diff_capabilities(
        this.backends.get(primary_id)?.capabilities,
        fallback.capabilities,
      ),
    });

    const scorer = this.provider_registry.get_health_scorer();
    const start = Date.now();
    try {
      const result = await fallback.run(options);
      const is_error = result.finish_reason === "error";
      const fb_breaker = fallback_id ? this.breakers.get(fallback_id) : undefined;
      if (is_error) fb_breaker?.record_failure(); else fb_breaker?.record_success();
      scorer.record(fallback_id!, { ok: !is_error, latency_ms: Date.now() - start });
      if (result.session && this.session_store) {
        try { this.session_store.save(result.session, { task_id: options.task_id, metadata: result.metadata }); } catch { /* 영속화 실패 무시 */ }
      }
      return result;
    } catch (error) {
      const fb_breaker = fallback_id ? this.breakers.get(fallback_id) : undefined;
      fb_breaker?.record_failure();
      scorer.record(fallback_id!, { ok: false, latency_ms: Date.now() - start });
      throw error;
    }
  }

  /** 세션 스토어 접근. */
  get_session_store(): AgentSessionStore | null {
    return this.session_store;
  }

  /** 모든 백엔드의 리소스 정리 (자식 프로세스, 소켓 등). */
  close(): void {
    for (const backend of this.backends.values()) {
      try { backend.stop?.(); } catch { /* best-effort */ }
    }
  }
}

/** primary와 fallback 간 capabilities 차이를 문자열 배열로 반환. */
function _diff_capabilities(
  primary?: BackendCapabilities,
  fallback?: BackendCapabilities,
): string[] {
  if (!primary || !fallback) return [];
  const keys = Object.keys(primary) as (keyof BackendCapabilities)[];
  return keys
    .filter((k) => primary[k] && !fallback[k])
    .map((k) => `-${k}`);
}
