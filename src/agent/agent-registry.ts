import { error_message } from "../utils/common.js";
import type { ProviderRegistry } from "../providers/service.js";
import { CircuitBreaker } from "../providers/circuit-breaker.js";
import type { ProviderId } from "../providers/types.js";
import type { ExecutionMode } from "../orchestration/types.js";
import type { AgentBackend, AgentBackendId, AgentProviderConfig, AgentRunOptions, AgentRunResult, BackendCapabilities } from "./agent.types.js";
import type { AgentSessionStore } from "./agent-session-store.js";
import type { AgentProviderStore } from "./provider-store.js";
import type { Logger } from "../logger.js";
import { FailoverError } from "./pty/types.js";

export type AgentBackendConfig = {
  /** claude 실행에 사용할 백엔드. */
  claude_backend: "claude_cli" | "claude_sdk";
  /** codex 실행에 사용할 백엔드. */
  codex_backend: "codex_cli" | "codex_appserver";
  /** gemini 실행에 사용할 백엔드. */
  gemini_backend?: "gemini_cli";
};

const DEFAULT_CONFIG: AgentBackendConfig = {
  claude_backend: "claude_cli",
  codex_backend: "codex_cli",
  gemini_backend: "gemini_cli",
};

/** 레거시 fallback 쌍 (정적). resolve_for_mode 미사용 시의 안전망. */
const LEGACY_FALLBACK_MAP: Record<string, string> = {
  claude_sdk: "claude_cli",
  codex_appserver: "codex_cli",
};

export type BackendStatusInfo = {
  id: string;
  provider_type: string;
  available: boolean;
  circuit_state: "closed" | "open" | "half_open";
  priority: number;
  supported_modes: ExecutionMode[];
  capabilities: BackendCapabilities;
};

/**
 * AgentBackend를 관리하고 ProviderRegistry를 래핑하는 통합 레지스트리.
 * 동적 등록/해제, 모드+스킬 기반 스마트 라우팅, 대시보드용 상태 조회를 지원.
 */
export class AgentBackendRegistry {
  private readonly backends = new Map<AgentBackendId, AgentBackend>();
  private readonly breakers = new Map<AgentBackendId, CircuitBreaker>();
  private readonly provider_configs = new Map<AgentBackendId, AgentProviderConfig>();
  private readonly provider_registry: ProviderRegistry;
  private readonly config: AgentBackendConfig;
  private readonly session_store: AgentSessionStore | null;
  private readonly _provider_store: AgentProviderStore | null;
  private readonly logger: Logger | null;

  constructor(deps: {
    provider_registry: ProviderRegistry;
    backends?: AgentBackend[];
    config?: AgentBackendConfig;
    provider_store?: AgentProviderStore | null;
    session_store?: AgentSessionStore | null;
    logger?: Logger | null;
  }) {
    this.provider_registry = deps.provider_registry;
    this.config = deps.config || DEFAULT_CONFIG;
    this.session_store = deps.session_store || null;
    this._provider_store = deps.provider_store ?? null;
    this.logger = deps.logger || null;
    for (const backend of deps.backends ?? []) {
      this.backends.set(backend.id, backend);
      this.breakers.set(backend.id, new CircuitBreaker());
    }
  }

  // ── 동적 등록/해제 ──

  /** 백엔드를 등록 (이미 존재하면 교체 = 핫스왑). */
  register(backend: AgentBackend, config?: AgentProviderConfig): boolean {
    const existing = this.backends.get(backend.id);
    if (existing && existing !== backend) {
      try { existing.stop?.(); } catch { /* best-effort */ }
    }
    this.backends.set(backend.id, backend);
    if (!this.breakers.has(backend.id)) {
      this.breakers.set(backend.id, new CircuitBreaker());
    }
    if (config) {
      this.provider_configs.set(backend.id, config);
    }
    this.logger?.info("backend_registered", { id: backend.id, provider_type: config?.provider_type });
    return true;
  }

  /** 백엔드를 해제하고 리소스를 정리. */
  async unregister(instance_id: string): Promise<boolean> {
    const backend = this.backends.get(instance_id);
    if (!backend) return false;
    try { await backend.stop?.(); } catch { /* best-effort */ }
    this.backends.delete(instance_id);
    this.breakers.delete(instance_id);
    this.provider_configs.delete(instance_id);
    this.logger?.info("backend_unregistered", { id: instance_id });
    return true;
  }

  // ── 조회 ──

  list_backends(): AgentBackendId[] {
    return [...this.backends.keys()];
  }

  get_backend(id: AgentBackendId): AgentBackend | null {
    return this.backends.get(id) || null;
  }

  // ── 레거시 호환 라우팅 (ProviderId → AgentBackendId) ──

  resolve_backend_id(provider_id: ProviderId): AgentBackendId | null {
    if (provider_id === "claude_code") return this.config.claude_backend;
    if (provider_id === "chatgpt") return this.config.codex_backend;
    if (provider_id === "gemini") return this.config.gemini_backend || "gemini_cli";
    // openrouter, orchestrator_llm 등 API 기반 프로바이더는 CLI 백엔드 없음
    if (provider_id === "openrouter" || provider_id === "orchestrator_llm") return null;
    return this.config.codex_backend;
  }

  resolve_backend(provider_id: ProviderId): AgentBackend | null {
    const id = this.resolve_backend_id(provider_id);
    if (!id) return null;
    return this.backends.get(id) || null;
  }

  // ── 스마트 라우팅 ──

  /**
   * 실행 모드 + 스킬 선호도를 고려하여 최적 백엔드를 해석.
   *
   * 알고리즘:
   * 1. 등록 백엔드 중 is_available() && circuit.can_acquire() 필터
   * 2. supported_modes에 현재 mode 포함하는 것만 필터
   * 3. skill_preferences가 있으면 순서대로 instance_id 또는 provider_type 매칭
   * 4. 매칭 없으면 priority ASC 정렬 후 첫 번째 반환
   */
  resolve_for_mode(mode: ExecutionMode, skill_preferences?: string[]): AgentBackend | null {
    const candidates = this._get_available_for_mode(mode);
    if (candidates.length === 0) return null;

    // 스킬 선호도 매칭
    if (skill_preferences?.length) {
      for (const pref of skill_preferences) {
        const matched = candidates.find((c) =>
          c.id === pref || this.provider_configs.get(c.id)?.provider_type === pref,
        );
        if (matched) return matched;
      }
    }

    // priority ASC 정렬 → 첫 번째 반환
    return candidates.sort((a, b) => {
      const pa = this.provider_configs.get(a.id)?.priority ?? 100;
      const pb = this.provider_configs.get(b.id)?.priority ?? 100;
      return pa - pb;
    })[0] ?? null;
  }

  /** 가용 백엔드 필터링 (mode, availability, circuit breaker). 슬롯 소비 없이 can_acquire 사용. */
  private _get_available_for_mode(mode: ExecutionMode): AgentBackend[] {
    const result: AgentBackend[] = [];
    for (const [id, backend] of this.backends) {
      if (!backend.is_available()) continue;
      const breaker = this.breakers.get(id);
      if (breaker && !breaker.can_acquire()) continue;

      const config = this.provider_configs.get(id);
      if (config) {
        if (!config.enabled) continue;
        if (config.supported_modes.length > 0 && !config.supported_modes.includes(mode)) continue;
      }
      result.push(backend);
    }
    return result;
  }

  // ── 대시보드용 상태 조회 ──

  list_backend_status(): BackendStatusInfo[] {
    const result: BackendStatusInfo[] = [];
    for (const [id, backend] of this.backends) {
      const config = this.provider_configs.get(id);
      const breaker = this.breakers.get(id);
      result.push({
        id,
        provider_type: config?.provider_type ?? id,
        available: backend.is_available(),
        circuit_state: breaker ? _circuit_state(breaker) : "closed",
        priority: config?.priority ?? 100,
        supported_modes: config?.supported_modes ?? [],
        capabilities: backend.capabilities,
      });
    }
    return result.sort((a, b) => a.priority - b.priority);
  }

  // ── 실행 ──

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
      if (is_error) breaker?.record_failure(); else breaker?.record_success();
      scorer.record(backend_id, { ok: !is_error, latency_ms: Date.now() - start });
      this._persist_session(result, options);
      return result;
    } catch (error) {
      scorer.record(backend_id, { ok: false, latency_ms: Date.now() - start });

      if (error instanceof FailoverError) {
        this._handle_failover_circuit(backend_id, breaker, error.meta);
        this.logger?.warn("backend_failover", {
          backend: backend_id,
          reason: error.meta.reason,
          provider: error.meta.provider,
          model: error.meta.model,
        });
        return this._try_fallback(backend_id, options, error.message);
      }

      breaker?.record_failure();
      return this._try_fallback(backend_id, options, error_message(error));
    }
  }

  /** FailoverError reason에 따라 circuit breaker를 차등 적용. */
  private _handle_failover_circuit(
    _backend_id: AgentBackendId,
    breaker: CircuitBreaker | undefined,
    meta: FailoverError["meta"],
  ): void {
    if (!breaker) return;
    switch (meta.reason) {
      case "auth":
      case "quota":
        // 인증/할당 문제 → 즉시 차단 (수동 복구 필요)
        for (let i = 0; i < 5; i++) breaker.record_failure();
        break;
      case "rate_limit":
        // 일시적 → 단일 실패 기록 (자동 half_open 복구)
        breaker.record_failure();
        break;
      default:
        breaker.record_failure();
    }
  }

  /** 동적 priority 기반 fallback. 레거시 맵도 참조. */
  private async _try_fallback(
    primary_id: AgentBackendId,
    options: AgentRunOptions,
    reason: string,
  ): Promise<AgentRunResult> {
    const fallback = this._find_fallback(primary_id);
    if (!fallback) throw new Error(reason);

    this.logger?.warn("backend_fallback", {
      primary: primary_id,
      fallback: fallback.id,
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
      const fb_breaker = this.breakers.get(fallback.id);
      if (is_error) fb_breaker?.record_failure(); else fb_breaker?.record_success();
      scorer.record(fallback.id, { ok: !is_error, latency_ms: Date.now() - start });
      this._persist_session(result, options);
      return result;
    } catch (error) {
      const fb_breaker = this.breakers.get(fallback.id);
      fb_breaker?.record_failure();
      scorer.record(fallback.id, { ok: false, latency_ms: Date.now() - start });
      throw error;
    }
  }

  /**
   * 실패한 백엔드를 제외하고 available + priority 순으로 fallback 후보를 찾음.
   * provider_configs가 있으면 동적 priority 기반, 없으면 레거시 맵 참조.
   */
  private _find_fallback(failed_id: string): AgentBackend | undefined {
    // 동적: failed_id 제외, available인 것들을 priority 순으로 시도
    if (this.provider_configs.size > 0) {
      const candidates = [...this.backends.entries()]
        .filter(([id, b]) => id !== failed_id && b.is_available())
        .map(([id, b]) => ({ id, backend: b, priority: this.provider_configs.get(id)?.priority ?? 100 }))
        .sort((a, b) => a.priority - b.priority);
      for (const c of candidates) {
        const breaker = this.breakers.get(c.id);
        if (!breaker || breaker.try_acquire()) return c.backend;
      }
    }

    // 레거시 fallback 맵
    const legacy_id = LEGACY_FALLBACK_MAP[failed_id];
    if (legacy_id) {
      const fb = this.backends.get(legacy_id);
      if (fb?.is_available()) return fb;
    }

    return undefined;
  }

  private _persist_session(result: AgentRunResult, options: AgentRunOptions): void {
    if (result.session && this.session_store) {
      try {
        this.session_store.save(result.session, { task_id: options.task_id, metadata: result.metadata });
      } catch { /* 영속화 실패는 실행 결과에 영향 없음 */ }
    }
  }

  get_session_store(): AgentSessionStore | null {
    return this.session_store;
  }

  async close(): Promise<void> {
    const stops = [...this.backends.values()].map(async (backend) => {
      try { await backend.stop?.(); } catch { /* best-effort */ }
    });
    await Promise.allSettled(stops);
  }
}

/** CircuitBreaker 상태를 문자열로 변환. 슬롯을 소비하지 않는 읽기 전용 조회. */
function _circuit_state(breaker: CircuitBreaker): "closed" | "open" | "half_open" {
  breaker.can_acquire(); // open→half_open 타임아웃 전환 트리거
  return breaker.state;
}

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
