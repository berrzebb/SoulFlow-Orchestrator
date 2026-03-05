import { MAX_CHAT_SESSIONS, MAX_MESSAGES_PER_SESSION, type ChatMediaItem, type ChatSession, type ChatSessionMessage } from "../service.js";
import { now_iso, short_id } from "../../utils/common.js";
import type { RouteContext } from "../route-context.js";

export async function handle_chat(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body, chat_sessions, session_store, session_store_key, bus } = ctx;

  // GET /api/chat/sessions — 목록
  if (url.pathname === "/api/chat/sessions" && req.method === "GET") {
    const sessions = [...chat_sessions.values()].map((s) => ({
      id: s.id,
      created_at: s.created_at,
      message_count: s.messages.length,
    }));
    json(res, 200, sessions);
    return true;
  }

  // POST /api/chat/sessions { id? } — 생성 또는 { action: "send", id, content, media? } — 전송
  if (url.pathname === "/api/chat/sessions" && req.method === "POST") {
    const body = await read_body(req);
    const action = String(body?.action || "").trim();

    if (action === "send") {
      const session_id = String(body?.id || "").trim();
      if (!session_id) { json(res, 400, { error: "id_required" }); return true; }
      const session = chat_sessions.get(session_id);
      if (!session) { json(res, 404, { error: "session_not_found" }); return true; }
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

    if (action === "get") {
      const session_id = String(body?.id || "").trim();
      if (!session_id) { json(res, 400, { error: "id_required" }); return true; }
      const session = chat_sessions.get(session_id);
      json(res, session ? 200 : 404, session ?? { error: "not_found" });
      return true;
    }

    // action 없으면 새 세션 생성
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
    json(res, 200, { id, created_at: session.created_at });
    return true;
  }

  // DELETE /api/chat/sessions { id } — 삭제
  if (url.pathname === "/api/chat/sessions" && req.method === "DELETE") {
    const body = await read_body(req);
    const session_id = String(body?.id || "").trim();
    if (!session_id) { json(res, 400, { error: "id_required" }); return true; }
    const deleted = chat_sessions.delete(session_id);
    await session_store?.delete?.(session_store_key(session_id));
    json(res, deleted ? 200 : 404, { deleted });
    return true;
  }

  return false;
}
