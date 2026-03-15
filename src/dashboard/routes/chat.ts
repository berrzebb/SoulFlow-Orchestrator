import { MAX_CHAT_SESSIONS, MAX_MESSAGES_PER_SESSION, type ChatMediaItem, type ChatSession, type ChatSessionMessage } from "../service.js";
import { now_iso, short_id } from "../../utils/common.js";
import type { RouteContext } from "../route-context.js";
import { set_no_cache, require_team_manager, get_filter_team_id } from "../route-context.js";

type ParsedBody = {
  text: string;
  media: ChatMediaItem[];
  model: string | undefined;
  provider_instance_id: string | undefined;
  system_prompt: string | undefined;
};

function parse_chat_body(body: Record<string, unknown> | null): ParsedBody {
  const text = String(body?.content || "").trim();
  const media_raw = Array.isArray(body?.media) ? (body.media as unknown[]) : [];
  const media: ChatMediaItem[] = media_raw
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => ({ type: String(m.type || "file"), url: String(m.url || ""), mime: m.mime ? String(m.mime) : undefined, name: m.name ? String(m.name) : undefined }))
    .filter((m) => m.url);
  const model = typeof body?.model === "string" ? body.model.trim() || undefined : undefined;
  const provider_instance_id = typeof body?.provider_instance_id === "string"
    ? body.provider_instance_id.trim() || undefined : undefined;
  const system_prompt = typeof body?.system_prompt === "string" ? body.system_prompt.trim() || undefined : undefined;
  return { text, media, model, provider_instance_id, system_prompt };
}

function append_user_message(session: ChatSession, parsed: ParsedBody): void {
  const msg: ChatSessionMessage = { direction: "user", content: parsed.text, at: now_iso() };
  if (parsed.media.length > 0) msg.media = parsed.media;
  if (parsed.model) msg.model = parsed.model;
  if (parsed.provider_instance_id) msg.provider_instance_id = parsed.provider_instance_id;
  session.messages.push(msg);
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages.splice(0, session.messages.length - MAX_MESSAGES_PER_SESSION);
  }
}

type PublishContext = { user_id: string; team_id: string; workspace_dir?: string };

function build_publish_payload(session: ChatSession, parsed: ParsedBody, pctx: PublishContext) {
  return {
    id: `web_msg_${short_id(8)}`,
    provider: "web" as const, channel: "web", sender_id: pctx.user_id || "web_user",
    chat_id: session.id, content: parsed.text, at: now_iso(),
    media: parsed.media.length > 0
      ? parsed.media.map((m) => ({ type: m.type as import("../../bus/types.js").MediaItemType, url: m.url, mime: m.mime, name: m.name }))
      : undefined,
    metadata: {
      ...(parsed.provider_instance_id ? { preferred_provider_id: parsed.provider_instance_id } : {}),
      ...(parsed.model ? { preferred_model: parsed.model } : {}),
      ...(parsed.system_prompt ? { system_prompt_override: parsed.system_prompt } : {}),
      ...(pctx.team_id ? { team_id: pctx.team_id } : {}),
      ...(pctx.workspace_dir ? { workspace_dir: pctx.workspace_dir } : {}),
    },
  };
}

export async function handle_chat(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body, auth_user, chat_sessions, session_store, session_store_key, bus, add_rich_stream_listener } = ctx;
  const path = url.pathname;
  const user_id = auth_user?.sub ?? "";
  const team_id = auth_user?.tid ?? "";
  const publish_ctx: PublishContext = {
    user_id, team_id,
    workspace_dir: ctx.workspace_runtime?.user_content ?? ctx.personal_dir,
  };

  // GET /api/chat/sessions
  if (path === "/api/chat/sessions" && req.method === "GET") {
    const sessions = [...chat_sessions.values()]
      .filter((s) => s.user_id === user_id && s.team_id === team_id)
      .map((s) => ({
        id: s.id,
        created_at: s.created_at,
        message_count: s.messages.length,
        ...(s.name ? { name: s.name } : {}),
      }));
    json(res, 200, sessions);
    return true;
  }

  // POST /api/chat/sessions — 새 세션 생성
  if (path === "/api/chat/sessions" && req.method === "POST") {
    const id = `web_${short_id(8)}`;
    const session: ChatSession = { id, user_id, team_id, created_at: now_iso(), messages: [] };
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
    // 세션 미존재 또는 다른 사용자 소유 → 동일하게 404 반환 (존재 여부 노출 방지)
    if (!session || session.user_id !== user_id || session.team_id !== team_id) { json(res, 404, { error: "not_found" }); return true; }
    json(res, 200, session);
    return true;
  }

  // PATCH /api/chat/sessions/:id — 세션 이름 변경
  if (id_match && req.method === "PATCH") {
    const session_id = decodeURIComponent(id_match[1]);
    const session = chat_sessions.get(session_id);
    if (!session || session.user_id !== user_id || session.team_id !== team_id) { json(res, 404, { error: "not_found" }); return true; }
    const body = await read_body(req);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : undefined;
    if (name !== undefined) session.name = name || undefined;
    json(res, 200, { id: session.id, name: session.name ?? null });
    return true;
  }

  // DELETE /api/chat/sessions/:id
  if (id_match && req.method === "DELETE") {
    const session_id = decodeURIComponent(id_match[1]);
    const session = chat_sessions.get(session_id);
    if (!session || session.user_id !== user_id || session.team_id !== team_id) { json(res, 404, { error: "not_found" }); return true; }
    chat_sessions.delete(session_id);
    await session_store?.delete?.(session_store_key(session_id));
    json(res, 200, { deleted: true });
    return true;
  }

  // POST /api/chat/sessions/:id/messages/stream — NDJSON 스트리밍 응답
  const stream_match = path.match(/^\/api\/chat\/sessions\/([^/]+)\/messages\/stream$/);
  if (stream_match && req.method === "POST") {
    const session_id = decodeURIComponent(stream_match[1]);
    const session = chat_sessions.get(session_id);
    if (!session || session.user_id !== user_id || session.team_id !== team_id) { json(res, 404, { error: "session_not_found" }); return true; }
    const body = await read_body(req);
    const parsed = parse_chat_body(body);
    if (!parsed.text && parsed.media.length === 0) { json(res, 400, { error: "content_or_media_required" }); return true; }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    set_no_cache(res);

    // 리스너를 발행 전에 등록해야 초기 delta를 놓치지 않음
    const unsubscribe = add_rich_stream_listener(session_id, (event) => {
      if (res.writableEnded) return;
      res.write(JSON.stringify(event) + "\n");
      if (event.type === "done") res.end();
    });

    // 도구 실행이 긴 작업(웹 탐색·검색 등)은 수 분이 걸릴 수 있음 — 절대 타임아웃은 10분으로 확장
    const timeout = setTimeout(() => {
      unsubscribe();
      clearInterval(keepalive);
      if (!res.writableEnded) { res.write(JSON.stringify({ type: "error", error: "timeout" }) + "\n"); res.end(); }
    }, 600_000);

    // 30초마다 keepalive 이벤트 — 무음 구간에서 HTTP 연결 유지 + 프록시 idle timeout 방지
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(JSON.stringify({ type: "heartbeat" }) + "\n");
    }, 30_000);

    req.on("close", () => { clearTimeout(timeout); clearInterval(keepalive); unsubscribe(); });

    append_user_message(session, parsed);
    session_store?.append_message(session_store_key(session_id), { role: "user", content: parsed.text, timestamp: now_iso() }).catch(() => {});

    res.write(JSON.stringify({ type: "start" }) + "\n");
    bus.publish_inbound(build_publish_payload(session, parsed, publish_ctx)).catch(() => {
      unsubscribe();
      clearTimeout(timeout);
      if (!res.writableEnded) { res.write(JSON.stringify({ type: "error", error: "publish_failed" }) + "\n"); res.end(); }
    });
    return true;
  }

  // POST /api/chat/sessions/:id/messages { content, media? }
  const msg_match = path.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);
  if (msg_match && req.method === "POST") {
    const session_id = decodeURIComponent(msg_match[1]);
    const session = chat_sessions.get(session_id);
    if (!session || session.user_id !== user_id || session.team_id !== team_id) { json(res, 404, { error: "session_not_found" }); return true; }
    const body = await read_body(req);
    const parsed = parse_chat_body(body);
    if (!parsed.text && parsed.media.length === 0) { json(res, 400, { error: "content_or_media_required" }); return true; }
    append_user_message(session, parsed);
    await session_store?.append_message(session_store_key(session_id), { role: "user", content: parsed.text, timestamp: now_iso() });
    await bus.publish_inbound(build_publish_payload(session, parsed, publish_ctx));
    json(res, 200, { ok: true, message_count: session.messages.length });
    return true;
  }

  // ── Mirror: 외부 채널 세션을 Web에서 조회 + 양방향 릴레이 ──
  // 접근 제어: team_manager 이상만 허용 (GET 포함 — 외부 채널 대화 내용은 팀 리소스)

  // GET /api/chat/mirror — 미러 가능한 외부 세션 목록
  if (path === "/api/chat/mirror" && req.method === "GET") {
    if (!require_team_manager(ctx)) return true;
    if (!session_store?.list_by_prefix) { json(res, 200, []); return true; }
    const filter_team = get_filter_team_id(ctx);
    const enabled = new Set(ctx.options.channels.get_status().enabled_channels);
    const provider_filter = url.searchParams.get("provider") ?? "";
    const prefix = provider_filter ? `${provider_filter}:` : "";
    const entries = await session_store.list_by_prefix(prefix, 200);
    const list = entries
      .filter((e) => !e.key.startsWith("web:"))
      .map((e) => {
        const parsed = parse_mirror_key(e.key);
        if (!parsed) return null;
        return { key: e.key, ...parsed, created_at: e.created_at, updated_at: e.updated_at, message_count: e.message_count };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .filter((e) => filter_team === undefined || e.team_id === filter_team)
      .filter((e) => enabled.size === 0 || enabled.has(e.provider));
    json(res, 200, list);
    return true;
  }

  // GET /api/chat/mirror/:session_key — 외부 세션 메시지 조회
  const mirror_match = path.match(/^\/api\/chat\/mirror\/([^/]+)$/);
  if (mirror_match && req.method === "GET") {
    if (!require_team_manager(ctx)) return true;
    if (!session_store) { json(res, 503, { error: "session_store_unavailable" }); return true; }
    const key = decodeURIComponent(mirror_match[1]);
    const parsed = parse_mirror_key(key);
    if (!parsed) { json(res, 400, { error: "invalid_session_key" }); return true; }
    const filter_team = get_filter_team_id(ctx);
    if (filter_team !== undefined && parsed.team_id !== filter_team) { json(res, 404, { error: "not_found" }); return true; }
    const session = await session_store.get_or_create(key);
    const messages = session.messages.map((m) => ({
      direction: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content || ""),
      sender_id: String((m as Record<string, unknown>).sender_id || ""),
      at: String((m as Record<string, unknown>).timestamp || (m as Record<string, unknown>).at || session.created_at),
    }));
    json(res, 200, { key, ...parsed, created_at: session.created_at, messages });
    return true;
  }

  // POST /api/chat/mirror/:session_key/messages — Web → 외부 채널 릴레이
  const mirror_msg_match = path.match(/^\/api\/chat\/mirror\/([^/]+)\/messages$/);
  if (mirror_msg_match && req.method === "POST") {
    if (!require_team_manager(ctx)) return true;
    const key = decodeURIComponent(mirror_msg_match[1]);
    const parsed = parse_mirror_key(key);
    if (!parsed || !parsed.provider || !parsed.chat_id) { json(res, 400, { error: "invalid_session_key" }); return true; }
    const filter_team = get_filter_team_id(ctx);
    if (filter_team !== undefined && parsed.team_id !== filter_team) { json(res, 404, { error: "not_found" }); return true; }

    const body = await read_body(req);
    const text = String(body?.content || "").trim();
    if (!text) { json(res, 400, { error: "content_required" }); return true; }

    await bus.publish_inbound({
      id: `mirror_${short_id(8)}`,
      provider: parsed.provider,
      channel: parsed.provider,
      sender_id: "web_mirror",
      chat_id: parsed.chat_id,
      content: text,
      at: now_iso(),
      metadata: { mirror: true, source_session_key: key, ...(parsed.team_id ? { team_id: parsed.team_id } : {}) },
    });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

/** 5-part 외부 세션 키 파싱. 4-part 레거시도 허용 (team_id=""). web: 키는 거부. */
function parse_mirror_key(key: string): { provider: string; team_id: string; chat_id: string; alias: string; thread: string } | null {
  const parts = key.split(":");
  if (parts[0] === "web") return null;
  if (parts.length >= 5) {
    return { provider: parts[0], team_id: parts[1], chat_id: parts[2], alias: parts[3], thread: parts[4] ?? "main" };
  }
  if (parts.length >= 4) {
    return { provider: parts[0], team_id: "", chat_id: parts[1], alias: parts[2], thread: parts[3] ?? "main" };
  }
  return null;
}
