import type { RouteContext } from "../route-context.js";
import { get_filter_team_id, get_filter_user_id } from "../route-context.js";

/**
 * FE-6: 세션 키 파싱. web 6파트와 external 5파트 모두 지원.
 * web 신 형식:     web:{team_id}:{user_id}:{chat_id}:{alias}:{thread} (6파트)
 * external 신 형식: {provider}:{team_id}:{chat_id}:{alias}:{thread}   (5파트)
 */
function parse_session_key(key: string) {
  const parts = key.split(":");
  const provider = parts[0] ?? "";
  if (provider === "web" && parts.length >= 6) {
    return {
      provider,
      team_id: parts[1] ?? "",
      user_id: parts[2] ?? "",
      chat_id: parts[3] ?? "",
      alias: parts[4] ?? "",
      thread: parts[5] ?? "main",
    };
  }
  return {
    provider,
    team_id: parts[1] ?? "",
    user_id: undefined as string | undefined,
    chat_id: parts[2] ?? "",
    alias: parts[3] ?? "",
    thread: parts[4] ?? "main",
  };
}

export async function handle_session(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, session_store } = ctx;
  const path = url.pathname;

  // GET /api/sessions?provider=...
  if (path === "/api/sessions" && req.method === "GET") {
    const store = session_store;
    if (!store?.list_by_prefix) { json(res, 200, []); return true; }
    const provider_filter = url.searchParams.get("provider") ?? "";
    const prefix = provider_filter ? `${provider_filter}:` : "";
    const entries = await store.list_by_prefix(prefix, 200);
    const team_id = get_filter_team_id(ctx);
    const user_id = get_filter_user_id(ctx);
    const list = entries
      .map((e) => {
        const parsed = parse_session_key(e.key);
        return {
          key: e.key,
          ...parsed,
          created_at: e.created_at,
          updated_at: e.updated_at,
          message_count: e.message_count,
        };
      })
      .filter((s) => team_id === undefined || s.team_id === team_id)
      .filter((s) => user_id === undefined || !s.user_id || s.user_id === user_id);
    json(res, 200, list);
    return true;
  }

  // GET /api/sessions/:key — 세션 상세 조회 (team + user ownership 검사)
  const key_match = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (key_match && req.method === "GET") {
    const store = session_store;
    if (!store) { json(res, 503, { error: "session_store_unavailable" }); return true; }
    const key = decodeURIComponent(key_match[1]);
    const parsed = parse_session_key(key);
    const team_id = get_filter_team_id(ctx);
    if (team_id !== undefined && parsed.team_id !== team_id) { json(res, 404, { error: "not_found" }); return true; }
    // FE-6: user_id 검사 — web 세션은 user_id가 키에 내장됨
    const user_id = get_filter_user_id(ctx);
    if (user_id !== undefined && parsed.user_id && parsed.user_id !== user_id) { json(res, 404, { error: "not_found" }); return true; }
    const session = await store.get_or_create(key);
    const messages = session.messages.map((m) => ({
      direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content || ""),
      at: String((m as Record<string, unknown>).timestamp || (m as Record<string, unknown>).at || session.created_at),
    }));
    json(res, 200, {
      key,
      provider: parsed.provider,
      chat_id: parsed.chat_id,
      user_id: parsed.user_id,
      created_at: session.created_at,
      messages,
    });
    return true;
  }

  return false;
}
