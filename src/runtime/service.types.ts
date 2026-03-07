export interface ServiceLike {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  health_check(): { ok: boolean; details?: Record<string, unknown> } | Promise<{ ok: boolean; details?: Record<string, unknown> }>;
}
