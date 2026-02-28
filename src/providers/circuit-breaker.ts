/** 프로바이더별 서킷 브레이커. closed → open (N회 실패) → half_open (타임아웃 후) → closed (성공 시). */

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerOptions = {
  failure_threshold?: number;
  reset_timeout_ms?: number;
  half_open_max?: number;
};

export class CircuitBreaker {
  private _state: CircuitState = "closed";
  private failure_count = 0;
  private half_open_attempts = 0;
  private last_failure_at = 0;

  private readonly failure_threshold: number;
  private readonly reset_timeout_ms: number;
  private readonly half_open_max: number;

  constructor(opts?: CircuitBreakerOptions) {
    this.failure_threshold = opts?.failure_threshold ?? 5;
    this.reset_timeout_ms = opts?.reset_timeout_ms ?? 30_000;
    this.half_open_max = opts?.half_open_max ?? 1;
  }

  get state(): CircuitState {
    return this._state;
  }

  /** open → half_open 타임아웃 전환. 상태 변이가 필요한 곳에서 명시적으로 호출. */
  private try_transition_to_half_open(): void {
    if (this._state === "open" && Date.now() - this.last_failure_at >= this.reset_timeout_ms) {
      this._state = "half_open";
      this.half_open_attempts = 0;
    }
  }

  /** 슬롯 소비 없이 요청 허용 여부만 확인. */
  can_acquire(): boolean {
    this.try_transition_to_half_open();
    if (this._state === "closed") return true;
    if (this._state === "half_open" && this.half_open_attempts < this.half_open_max) return true;
    return false;
  }

  /** 요청 허용 여부 확인 + half_open 슬롯 원자적 소비. */
  try_acquire(): boolean {
    this.try_transition_to_half_open();
    if (this._state === "closed") return true;
    if (this._state === "half_open" && this.half_open_attempts < this.half_open_max) {
      this.half_open_attempts += 1;
      return true;
    }
    return false;
  }

  record_success(): void {
    if (this._state === "half_open" || this._state === "open") {
      this._state = "closed";
    }
    this.failure_count = 0;
    this.half_open_attempts = 0;
  }

  record_failure(): void {
    this.failure_count += 1;
    this.last_failure_at = Date.now();

    if (this._state === "half_open") {
      this._state = "open";
      return;
    }
    if (this.failure_count >= this.failure_threshold) {
      this._state = "open";
    }
  }

  reset(): void {
    this._state = "closed";
    this.failure_count = 0;
    this.half_open_attempts = 0;
    this.last_failure_at = 0;
  }
}
