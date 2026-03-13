import type { RouteContext } from "../route-context.js";
import { get_filter_team_id } from "../route-context.js";

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
    const list = entries
      .map((e) => {
        const parts = e.key.split(":");
        return {
          key: e.key,
          provider: parts[0] ?? "",
          team_id: parts[1] ?? "",
          chat_id: parts[2] ?? "",
          alias: parts[3] ?? "",
          thread: parts[4] ?? "main",
          created_at: e.created_at,
          updated_at: e.updated_at,
          message_count: e.message_count,
        };
      })
      .filter((s) => team_id === undefined || s.team_id === team_id);
    json(res, 200, list);
    return true;
  }

  // GET /api/sessions/:key
  const key_match = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (key_match && req.method === "GET") {
    const store = session_store;
    if (!store) { json(res, 503, { error: "session_store_unavailable" }); return true; }
    const key = decodeURIComponent(key_match[1]);
    const session = await store.get_or_create(key);
    const parts = key.split(":");
    const messages = session.messages.map((m) => ({
      direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content || ""),
      at: String((m as Record<string, unknown>).timestamp || (m as Record<string, unknown>).at || session.created_at),
    }));
    json(res, 200, {
      key,
      provider: parts[0] ?? "",
      chat_id: parts[1] ?? "",
      created_at: session.created_at,
      messages,
    });
    return true;
  }

  return false;
}
