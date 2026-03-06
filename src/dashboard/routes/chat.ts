import { MAX_CHAT_SESSIONS, MAX_MESSAGES_PER_SESSION, type ChatMediaItem, type ChatSession, type ChatSessionMessage } from "../service.js";
import { now_iso, short_id } from "../../utils/common.js";
import type { RouteContext } from "../route-context.js";

export async function handle_chat(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body, chat_sessions, session_store, session_store_key, bus } = ctx;
  const path = url.pathname;

  // GET /api/chat/sessions
  if (path === "/api/chat/sessions" && req.method === "GET") {
    const sessions = [...chat_sessions.values()].map((s) => ({
      id: s.id,
      created_at: s.created_at,
      message_count: s.messages.length,
    }));
    json(res, 200, sessions);
    return true;
  }

  // POST /api/chat/sessions — 새 세션 생성
  if (path === "/api/chat/sessions" && req.method === "POST") {
    const id = `web_${short_id(8)}`;
    const session: ChatSession = { id, created_at: now_iso(), messages: [] };
    chat_sessions.set(id, session);
    if (chat_sessions.size > MAX_CHAT_SESSIONS) {
      const oldest = chat_sessions.keys().next().value;
      if (oldest) chat_sessions.delete(oldest);
    }
    if (session_store) {
      const store_session = await session_store.get_or_create(session_store_key(id));
      await session_store.save(store_session);
    }
    json(res, 201, { id, created_at: session.created_at });
    return true;
  }

  // GET /api/chat/sessions/:id
  const id_match = path.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const session_id = decodeURIComponent(id_match[1]);
    const session = chat_sessions.get(session_id);
    json(res, session ? 200 : 404, session ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/chat/sessions/:id
  if (id_match && req.method === "DELETE") {
    const session_id = decodeURIComponent(id_match[1]);
    const deleted = chat_sessions.delete(session_id);
    await session_store?.delete?.(session_store_key(session_id));
    json(res, deleted ? 200 : 404, { deleted });
    return true;
  }

  // POST /api/chat/sessions/:id/messages { content, media? }
  const msg_match = path.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
  if (msg_match && req.method === "POST") {
    const session_id = decodeURIComponent(msg_match[1]);
    const session = chat_sessions.get(session_id);
    if (!session) { json(res, 404, { error: "session_not_found" }); return true; }
    const body = await read_body(req);
    const text = String(body?.content || "").trim();
    const media_raw = Array.isArray(body?.media) ? (body.media as unknown[]) : [];
    const media: ChatMediaItem[] = media_raw
      .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
      .map((m) => ({ type: String(m.type || "file"), url: String(m.url || ""), mime: m.mime ? String(m.mime) : undefined, name: m.name ? String(m.name) : undefined }))
      .filter((m) => m.url);
    if (!text && media.length === 0) { json(res, 400, { error: "content_or_media_required" }); return true; }
    const user_msg: ChatSessionMessage = { direction: "user", content: text, at: now_iso() };
    if (media.length > 0) user_msg.media = media;
    session.messages.push(user_msg);
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages.splice(0, session.messages.length - MAX_MESSAGES_PER_SESSION);
    }
    await bus.publish_inbound({
      id: `web_msg_${short_id(8)}`,
      provider: "web",
      channel: "web",
      sender_id: "web_user",
      chat_id: session.id,
      content: text,
      at: now_iso(),
      media: media.length > 0 ? media.map((m) => ({ type: m.type as import("../../bus/types.js").MediaItemType, url: m.url, mime: m.mime, name: m.name })) : undefined,
    });
    json(res, 200, { ok: true, message_count: session.messages.length });
    return true;
  }

  // ── Mirror: 외부 채널 세션을 Web에서 조회 + 양방향 릴레이 ──

  // GET /api/chat/mirror — 미러 가능한 외부 세션 목록
  if (path === "/api/chat/mirror" && req.method === "GET") {
    if (!session_store?.list_by_prefix) { json(res, 200, []); return true; }
    const provider_filter = url.searchParams.get("provider") ?? "";
    const prefix = provider_filter ? `${provider_filter}:` : "";
    const entries = await session_store.list_by_prefix(prefix, 200);
    const list = entries
      .filter((e) => !e.key.startsWith("web:"))
      .map((e) => {
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

  // GET /api/chat/mirror/:session_key — 외부 세션 메시지 조회
  const mirror_match = path.match(/^\/api\/chat\/mirror\/([^/]+)$/);
  if (mirror_match && req.method === "GET") {
    if (!session_store) { json(res, 503, { error: "session_store_unavailable" }); return true; }
    const key = decodeURIComponent(mirror_match[1]);
    const session = await session_store.get_or_create(key);
    const parts = key.split(":");
    const messages = session.messages.map((m) => ({
      direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content || ""),
      sender_id: String((m as Record<string, unknown>).sender_id || ""),
      at: String((m as Record<string, unknown>).timestamp || (m as Record<string, unknown>).at || session.created_at),
    }));
    json(res, 200, {
      key,
      provider: parts[0] ?? "",
      chat_id: parts[1] ?? "",
      alias: parts[2] ?? "",
      thread: parts[3] ?? "main",
      created_at: session.created_at,
      messages,
    });
    return true;
  }

  // POST /api/chat/mirror/:session_key/messages — Web → 외부 채널 릴레이
  const mirror_msg_match = path.match(/^\/api\/chat\/mirror\/([^/]+)\/messages$/);
  if (mirror_msg_match && req.method === "POST") {
    const key = decodeURIComponent(mirror_msg_match[1]);
    const parts = key.split(":");
    const provider = parts[0] ?? "";
    const chat_id = parts[1] ?? "";
    if (!provider || !chat_id) { json(res, 400, { error: "invalid_session_key" }); return true; }

    const body = await read_body(req);
    const text = String(body?.content || "").trim();
    if (!text) { json(res, 400, { error: "content_required" }); return true; }

    await bus.publish_inbound({
      id: `mirror_${short_id(8)}`,
      provider,
      channel: provider,
      sender_id: "web_mirror",
      chat_id,
      content: text,
      at: now_iso(),
      metadata: { mirror: true, source_session_key: key },
    });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
