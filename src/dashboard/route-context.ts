/** 라우트 핸들러 공통 컨텍스트. */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardOptions, ChatSession, RecentMessage } from "./service.js";
import type { SystemMetricsCollector } from "./system-metrics.js";
import type { SessionStoreLike } from "../session/index.js";
import type { JwtPayload } from "../auth/auth-service.js";
import type { TeamRole } from "../auth/team-store.js";

/** Phase 8-23: 현재 요청의 팀 문맥. auth_middleware 검증 후 주입. */
export type TeamContext = {
  team_id: string;
  team_role: TeamRole;
};

/** Phase 8-24: 사용자 워크스페이스 런타임 접근 인터페이스. per-user RuntimeApp 완성 전까지 null. */
export type WorkspaceRuntimeLike = {
  team_id: string;
  user_id: string;
  workspace_path: string;
};

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  options: DashboardOptions;
  /** 인증된 사용자의 JWT 페이로드. 인증 비활성 또는 미인증 시 null. */
  auth_user: JwtPayload | null;
  /** Phase 8-23: 현재 요청의 팀 문맥. 인증 비활성 또는 미인증 시 null. */
  team_context: TeamContext | null;
  /** Phase 8-24: 현재 사용자의 워크스페이스 런타임. per-user RuntimeApp 완성 전까지 null. */
  workspace_runtime: WorkspaceRuntimeLike | null;
  /** [global, team, personal] 워크스페이스 레이어 경로 (낮은 → 높은 우선순위). */
  workspace_layers: string[];
  /** 저장/삭제용 개인 workspace 경로 (최상위 레이어). */
  personal_dir: string;
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
