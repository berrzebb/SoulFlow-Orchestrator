export const DEFAULT_HEARTBEAT_INTERVAL_S = 30 * 60;
export const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";
export const HEARTBEAT_PROMPT =
  `Read HEARTBEAT.md in your workspace and follow any instructions listed there. ` +
  `If nothing needs attention, reply with exactly: ${HEARTBEAT_OK_TOKEN}`;

export type OnHeartbeat = (prompt: string) => Promise<string>;
export type OnNotify = (message: string) => Promise<void>;

export type HeartbeatServiceOptions = {
  on_heartbeat?: OnHeartbeat | null;
  on_notify?: OnNotify | null;
  interval_s?: number;
  enabled?: boolean;
};

export type HeartbeatStatus = {
  running: boolean;
  enabled: boolean;
  paused?: boolean;
  interval_s: number;
  heartbeat_file: string;
};
