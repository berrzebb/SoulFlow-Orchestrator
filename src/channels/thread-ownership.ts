/** Thread Ownership — 멀티 에이전트 스레드 소유권 관리.
 *
 * 동일 스레드에 여러 에이전트가 동시 응답하는 것을 방지.
 * - claim: 에이전트가 스레드 소유권 획득 (이미 다른 에이전트가 소유 시 conflict)
 * - release: 소유권 해제
 * - touch: TTL 갱신 (활동 중인 스레드 만료 방지)
 * - TTL 기반 자동 만료로 좀비 소유권 방지
 */

export type ThreadOwnershipOptions = {
  /** 소유권 TTL (ms). 이 시간 동안 touch 없으면 만료. 기본 5분. */
  ttl_ms?: number;
  /** GC 주기 (ms). 만료 항목 정리 간격. 기본 60초. */
  gc_interval_ms?: number;
  /** 최대 동시 소유 수. 초과 시 가장 오래된 항목부터 강제 만료. */
  max_entries?: number;
};

export type ThreadClaim = {
  agent_alias: string;
  provider: string;
  chat_id: string;
  thread_id: string;
  claimed_at: number;
  last_active_at: number;
};

export type ClaimResult =
  | { ok: true; claim: ThreadClaim }
  | { ok: false; error: "conflict"; owner: string; claim: ThreadClaim };

/** 스레드 키 생성. */
function thread_key(provider: string, chat_id: string, thread_id: string): string {
  return `${provider}::${chat_id}::${thread_id}`;
}

export class ThreadOwnership {
  private readonly claims = new Map<string, ThreadClaim>();
  private readonly ttl_ms: number;
  private readonly max_entries: number;
  private gc_timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: ThreadOwnershipOptions) {
    this.ttl_ms = opts?.ttl_ms ?? 300_000;
    this.max_entries = opts?.max_entries ?? 5_000;
    const gc_interval = opts?.gc_interval_ms ?? 60_000;
    if (gc_interval > 0) {
      this.gc_timer = setInterval(() => this.gc(), gc_interval);
      if (this.gc_timer.unref) this.gc_timer.unref();
    }
  }

  /** 스레드 소유권 획득 시도. 이미 다른 에이전트가 소유 중이면 conflict. */
  claim(provider: string, chat_id: string, thread_id: string, agent_alias: string): ClaimResult {
    const key = thread_key(provider, chat_id, thread_id);
    const existing = this.claims.get(key);
    const now = Date.now();

    if (existing) {
      // 만료 확인
      if (now - existing.last_active_at > this.ttl_ms) {
        this.claims.delete(key);
      } else if (existing.agent_alias !== agent_alias) {
        return { ok: false, error: "conflict", owner: existing.agent_alias, claim: existing };
      } else {
        // 동일 에이전트 재진입 → touch
        existing.last_active_at = now;
        return { ok: true, claim: existing };
      }
    }

    this.evict_if_full();
    const claim: ThreadClaim = {
      agent_alias,
      provider,
      chat_id,
      thread_id,
      claimed_at: now,
      last_active_at: now,
    };
    this.claims.set(key, claim);
    return { ok: true, claim };
  }

  /** 소유권 해제. */
  release(provider: string, chat_id: string, thread_id: string): boolean {
    return this.claims.delete(thread_key(provider, chat_id, thread_id));
  }

  /** 활동 갱신 (TTL 연장). */
  touch(provider: string, chat_id: string, thread_id: string): boolean {
    const claim = this.claims.get(thread_key(provider, chat_id, thread_id));
    if (!claim) return false;
    claim.last_active_at = Date.now();
    return true;
  }

  /** 스레드 현재 소유자 조회. 만료된 소유권은 null. */
  owner_of(provider: string, chat_id: string, thread_id: string): string | null {
    const claim = this.claims.get(thread_key(provider, chat_id, thread_id));
    if (!claim) return null;
    if (Date.now() - claim.last_active_at > this.ttl_ms) {
      this.claims.delete(thread_key(provider, chat_id, thread_id));
      return null;
    }
    return claim.agent_alias;
  }

  /** 특정 에이전트가 소유 중인지 확인. */
  is_owned_by(provider: string, chat_id: string, thread_id: string, agent_alias: string): boolean {
    return this.owner_of(provider, chat_id, thread_id) === agent_alias;
  }

  /** 특정 에이전트가 소유한 모든 스레드 조회. */
  list_by_agent(agent_alias: string): ThreadClaim[] {
    const now = Date.now();
    const result: ThreadClaim[] = [];
    for (const claim of this.claims.values()) {
      if (claim.agent_alias === agent_alias && now - claim.last_active_at <= this.ttl_ms) {
        result.push(claim);
      }
    }
    return result;
  }

  /** 활성 소유권 수. */
  get active_count(): number {
    return this.claims.size;
  }

  /** 만료 항목 정리. */
  gc(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, claim] of this.claims) {
      if (now - claim.last_active_at > this.ttl_ms) {
        this.claims.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** 리소스 정리. */
  dispose(): void {
    if (this.gc_timer) {
      clearInterval(this.gc_timer);
      this.gc_timer = null;
    }
    this.claims.clear();
  }

  /** max_entries 초과 시 가장 오래된 항목 강제 제거. */
  private evict_if_full(): void {
    if (this.claims.size < this.max_entries) return;
    let oldest_key = "";
    let oldest_time = Infinity;
    for (const [key, claim] of this.claims) {
      if (claim.last_active_at < oldest_time) {
        oldest_time = claim.last_active_at;
        oldest_key = key;
      }
    }
    if (oldest_key) this.claims.delete(oldest_key);
  }
}
