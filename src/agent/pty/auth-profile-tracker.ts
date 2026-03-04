/** Auth 프로파일 순환 — 같은 CLI 내 복수 API 키 간 라운드로빈 + 쿨다운. */

export type ProfileStatus = "active" | "cooldown";

type ProfileEntry = {
  index: number;
  status: ProfileStatus;
  cooldown_until: number;
};

/**
 * 복수 인증 프로파일(API 키)을 라운드로빈으로 순환.
 * auth 에러 시 현재 프로파일을 쿨다운에 넣고 다음으로 전진.
 * 모든 프로파일이 쿨다운이면 사용 불가 → FailoverError로 전파.
 */
export class AuthProfileTracker {
  private readonly profiles: ProfileEntry[];
  private current_idx = 0;
  private readonly cooldown_ms: number;

  constructor(count: number, cooldown_ms = 60_000) {
    this.cooldown_ms = cooldown_ms;
    this.profiles = Array.from({ length: Math.max(1, count) }, (_, i) => ({
      index: i,
      status: "active" as ProfileStatus,
      cooldown_until: 0,
    }));
  }

  get count(): number {
    return this.profiles.length;
  }

  get current(): number {
    return this.current_idx;
  }

  /** 성공 기록. 현재 프로파일을 active로 유지/복구. */
  mark_good(): void {
    const p = this.profiles[this.current_idx]!;
    p.status = "active";
    p.cooldown_until = 0;
  }

  /**
   * 실패 기록. 현재 프로파일을 쿨다운에 넣고 다음 가용 프로파일로 전진.
   * 가용 프로파일이 없으면 null 반환.
   */
  mark_failure(): number | null {
    const now = Date.now();
    const current = this.profiles[this.current_idx]!;
    current.status = "cooldown";
    current.cooldown_until = now + this.cooldown_ms;

    // 쿨다운 만료된 프로파일 복구
    for (const p of this.profiles) {
      if (p.status === "cooldown" && p.cooldown_until <= now) {
        p.status = "active";
        p.cooldown_until = 0;
      }
    }

    // 다음 active 프로파일 탐색 (라운드로빈)
    for (let i = 1; i <= this.profiles.length; i++) {
      const idx = (this.current_idx + i) % this.profiles.length;
      if (this.profiles[idx]!.status === "active") {
        this.current_idx = idx;
        return idx;
      }
    }

    return null;
  }

  /** 사용 가능한 프로파일이 있는지. 쿨다운 만료도 반영. */
  has_available(): boolean {
    if (this.profiles.length <= 1) return false;
    const now = Date.now();
    return this.profiles.some(
      (p) => p.status === "active" || p.cooldown_until <= now,
    );
  }

  /**
   * 현재 프로파일 인덱스에 대응하는 환경변수를 반환.
   * key_map: { 0: { ANTHROPIC_API_KEY: "sk-a" }, 1: { ANTHROPIC_API_KEY: "sk-b" } }
   */
  resolve_env(key_map: Map<number, Record<string, string>>): Record<string, string> {
    return key_map.get(this.current_idx) ?? {};
  }
}
