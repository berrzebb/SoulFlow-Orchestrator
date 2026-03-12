/**
 * Webhook 라우트 — /hooks/wake, /hooks/agent, /hooks/* (수동 저장소).
 * 토큰 인증 + 세션 wake + 직접 에이전트 호출 지원.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { now_iso, short_id } from "../../utils/common.js";
import type { WebhookStore } from "../../services/webhook-store.service.js";
import type { IncomingMessage, ServerResponse } from "node:http";

export type WebhookDeps = {
  webhook_store: WebhookStore;
  /** Bearer 토큰. 미설정 시 인증 없이 허용. */
  webhook_secret?: string;
  /** 인바운드 메시지 발행. wake/agent에서 사용. */
  publish_inbound: (msg: import("../../bus/types.js").InboundMessage) => Promise<void>;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  read_body: (req: IncomingMessage) => Promise<Record<string, unknown> | null>;
};

/** Authorization 헤더 검증. secret 미설정 시 통과. */
function verify_token(req: IncomingMessage, secret: string | undefined): boolean {
  if (!secret) return true;
  const auth = String(req.headers.authorization || "").trim();
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  // SHA-256 해시 후 timingSafeEqual — 길이/내용 모두 timing leak 방지
  const expected = createHash("sha256").update(secret, "utf8").digest();
  const actual = createHash("sha256").update(token, "utf8").digest();
  return timingSafeEqual(expected, actual);
}

/**
 * /hooks/wake — 기존 세션 wake.
 * POST body: { session_key, message, provider?, chat_id? }
 */
async function handle_wake(deps: WebhookDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    deps.json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  const body = await deps.read_body(req);
  const session_key = String(body?.session_key || "").trim();
  const message = String(body?.message || "").trim();
  if (!session_key) {
    deps.json(res, 400, { ok: false, error: "session_key_required" });
    return;
  }

  const provider = String(body?.provider || "webhook").trim();
  const chat_id = String(body?.chat_id || session_key).trim();

  await deps.publish_inbound({
    id: `hook_wake_${short_id(8)}`,
    provider,
    channel: provider,
    sender_id: "webhook",
    chat_id,
    content: message || `[webhook wake: ${session_key}]`,
    at: now_iso(),
    metadata: {
      kind: "webhook_wake",
      session_key,
      source: "webhook",
    },
  });

  deps.json(res, 200, { ok: true, session_key, message_id: `hook_wake_${session_key}` });
}

/**
 * /hooks/agent — 직접 에이전트 호출.
 * POST body: { task, provider?, chat_id?, alias? }
 */
async function handle_agent_hook(deps: WebhookDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    deps.json(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  const body = await deps.read_body(req);
  const task = String(body?.task || "").trim();
  if (!task) {
    deps.json(res, 400, { ok: false, error: "task_required" });
    return;
  }

  const provider = String(body?.provider || "webhook").trim();
  const chat_id = String(body?.chat_id || `hook_agent_${short_id(8)}`).trim();
  const alias = String(body?.alias || "").trim() || undefined;

  const msg_id = `hook_agent_${short_id(8)}`;
  await deps.publish_inbound({
    id: msg_id,
    provider,
    channel: provider,
    sender_id: "webhook",
    chat_id,
    content: task,
    at: now_iso(),
    metadata: {
      kind: "webhook_agent",
      source: "webhook",
      ...(alias ? { target_alias: alias } : {}),
    },
  });

  deps.json(res, 200, { ok: true, message_id: msg_id, chat_id });
}

/**
 * /hooks/* — 기존 패시브 데이터 저장소.
 * GET/POST/PUT/DELETE → WebhookStore에 페이로드 저장.
 */
async function handle_passive(
  deps: WebhookDeps, req: IncomingMessage, res: ServerResponse, hook_path: string, url: URL,
): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k] = v;
  }
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });

  let body: unknown = null;
  if (req.method !== "GET") {
    body = await deps.read_body(req);
  }

  deps.webhook_store.push(hook_path, {
    method: req.method || "GET",
    headers,
    body,
    query,
    received_at: now_iso(),
  });

  deps.json(res, 200, { ok: true, path: hook_path });
}

/** 메인 webhook 라우트 디스패처. */
export async function dispatch_webhook(
  deps: WebhookDeps, req: IncomingMessage, res: ServerResponse, url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/hooks/")) return false;

  // 토큰 인증
  if (!verify_token(req, deps.webhook_secret)) {
    deps.json(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }

  const sub_path = url.pathname.slice(6); // "/hooks/wake" → "/wake"

  if (sub_path === "/wake") {
    await handle_wake(deps, req, res);
    return true;
  }

  if (sub_path === "/agent") {
    await handle_agent_hook(deps, req, res);
    return true;
  }

  // 나머지는 패시브 데이터 저장소
  await handle_passive(deps, req, res, sub_path, url);
  return true;
}
