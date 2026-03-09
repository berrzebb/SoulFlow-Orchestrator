/** 라우트 핸들러 공통 컨텍스트. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardOptions, ChatSession, RecentMessage } from "./service.js";
import type { SystemMetricsCollector } from "./system-metrics.js";
import type { SessionStoreLike } from "../session/index.js";

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  options: DashboardOptions;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  read_body: (req: IncomingMessage) => Promise<Record<string, unknown> | null>;
  add_sse_client: (res: ServerResponse) => void;
  build_state: () => Promise<Record<string, unknown>>;
  build_merged_tasks: () => Promise<unknown[]>;
  recent_messages: RecentMessage[];
  metrics: SystemMetricsCollector;
  chat_sessions: Map<string, ChatSession>;
  session_store: SessionStoreLike | null;
  session_store_key: (chat_id: string) => string;
  register_media_token: (abs_path: string) => string | null;
  oauth_callback_handler?: (code: string, state: string) => Promise<{ ok: boolean; instance_id?: string; error?: string }>;
  oauth_callback_html: (success: boolean, message: string) => string;
  resolve_request_origin: (req: IncomingMessage) => string;
  bus: DashboardOptions["bus"];
  add_rich_stream_listener: (chat_id: string, fn: (event: import("./broadcaster.js").WebStreamEvent) => void) => () => void;
};

export type RouteHandler = (ctx: RouteContext) => Promise<boolean>;

export function set_no_cache(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}
