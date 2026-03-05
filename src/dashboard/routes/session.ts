import type { RouteContext } from "../route-context.js";

export async function handle_session(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, session_store, read_body } = ctx;

  if (url.pathname !== "/api/sessions") return false;

  // GET /api/sessions?provider=... — 목록
  if (req.method === "GET") {
    const store = session_store;
    if (!store?.list_by_prefix) { json(res, 200, []); return true; }
    const provider_filter = url.searchParams.get("provider") ?? "";
    const prefix = provider_filter ? `${provider_filter}:` : "";
    const entries = await store.list_by_prefix(prefix, 200);
    const list = entries.map((e) => {
      const parts = e.key.split(":");
      return {
        key: e.key,
        provider: parts[0] ?? "",
        chat_id: parts[1] ?? "",
        alias: parts[2] ?? "",
        thread: parts[3] ?? "main",
        created_at: e.created_at,
        updated_at: e.updated_at,
        message_count: e.message_count,
      };
    });
    json(res, 200, list);
    return true;
  }

  // POST /api/sessions { key } — 단건 조회
  if (req.method === "POST") {
    const store = session_store;
    if (!store) { json(res, 503, { error: "session_store_unavailable" }); return true; }
    const body = await read_body(req);
    const key = String(body?.key || "").trim();
    if (!key) { json(res, 400, { error: "key_required" }); return true; }
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
