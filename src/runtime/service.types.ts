/** 공통 서비스 라이프사이클 인터페이스. */
export interface ServiceLike {
  /** 서비스 식별자 (로그·watchdog 용). */
  readonly name: string;

  /** 서비스를 시작한다. 이미 실행 중이면 no-op이어도 무방하다. */
  start(): Promise<void>;

  /** 서비스를 정지한다. 이미 정지 상태이면 no-op이어도 무방하다. */
  stop(): Promise<void>;

  /**
   * 현재 서비스가 정상 상태인지 반환한다.
   * 비동기 상태 조회가 필요한 서비스는 Promise를 반환해도 무방하다.
   */
  health_check(): { ok: boolean; details?: Record<string, unknown> } | Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
