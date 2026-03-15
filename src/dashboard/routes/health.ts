import type { IncomingMessage } from "node:http";
import { now_iso } from "../../utils/common.js";
import type { RouteContext } from "../route-context.js";
import { get_filter_team_id, require_team_manager } from "../route-context.js";

const CLAUDE_CODE_NATIVE_TOOLS = [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  "Agent", "WebFetch", "WebSearch",
  "NotebookRead", "NotebookEdit",
  "TodoWrite", "TodoRead",
] as const;

export async function handle_health(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json } = ctx;

  // Stats API
  if (url.pathname === "/api/stats/cdscore" && req.method === "GET") {
    const stats = options.stats_ops;
    if (!stats) { json(res, 503, { error: "stats_unavailable" }); return true; }
    json(res, 200, stats.get_cd_score());
    return true;
  }
  if (url.pathname === "/api/stats/cdscore" && req.method === "DELETE") {
    const stats = options.stats_ops;
    if (!stats) { json(res, 503, { error: "stats_unavailable" }); return true; }
    stats.reset_cd_score();
    json(res, 200, { ok: true });
    return true;
  }

  // DLQ API — FE-6a: 운영 데이터, team_manager 이상만 접근
  if (url.pathname === "/api/dlq" && req.method === "GET") {
    if (!require_team_manager(ctx)) return true;
    const dlq = options.dlq;
    if (!dlq) { json(res, 503, { error: "dlq_unavailable" }); return true; }
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    json(res, 200, await dlq.list(limit));
    return true;
  }

  // DLQ Replay — FE-6a: team_manager 이상만 접근
  if (url.pathname === "/api/dlq/replay" && req.method === "POST") {
    if (!require_team_manager(ctx)) return true;
    const dlq = options.dlq;
    const dispatch = options.dispatch;
    if (!dlq) { json(res, 503, { error: "dlq_unavailable" }); return true; }
    if (!dispatch) { json(res, 503, { error: "dispatch_unavailable" }); return true; }

    const body = (req as IncomingMessage & { body?: unknown }).body as Record<string, unknown> | undefined;
    const ids = Array.isArray(body?.ids)
      ? (body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const provider_filter = typeof body?.provider === "string" ? body.provider : undefined;
    const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)));

    const records = await dlq.list(ids.length > 0 ? ids.length * 2 : limit);
    const to_replay = ids.length > 0
      ? records.filter((r) => r.id !== undefined && ids.includes(r.id))
      : provider_filter
        ? records.filter((r) => r.provider === provider_filter)
        : records.slice(0, limit);

    const results: Array<{ id: number | undefined; ok: boolean; error?: string }> = [];
    for (const record of to_replay) {
      const msg: import("../../bus/types.js").OutboundMessage = {
        id: record.message_id || `dlq_replay_${Date.now()}`,
        provider: record.provider,
        channel: record.chat_id,
        sender_id: record.sender_id,
        chat_id: record.chat_id,
        content: record.content,
        at: now_iso(),
        reply_to: record.reply_to || undefined,
        thread_id: record.thread_id || undefined,
        metadata: { ...record.metadata, dlq_replayed: true },
      };
      const result = await dispatch.send(record.provider, msg);
      results.push({ id: record.id, ok: result.ok, error: result.error });
    }

    const replayed_ids = results.filter((r) => r.ok && r.id !== undefined).map((r) => r.id as number);
    if (replayed_ids.length > 0) await dlq.delete_by_ids(replayed_ids);

    json(res, 200, {
      replayed: replayed_ids.length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
    return true;
  }

  // Workflow Events API — FE-6a: team_id 스코핑 추가
  if (url.pathname === "/api/workflow/events" && req.method === "GET") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const filter: import("../../events/index.js").ListWorkflowEventsFilter = { limit, offset };
    const phase = url.searchParams.get("phase");
    if (phase) filter.phase = phase as import("../../events/index.js").WorkflowPhase;
    const task_id = url.searchParams.get("task_id");
    if (task_id) filter.task_id = task_id;
    const run_id_param = url.searchParams.get("run_id");
    if (run_id_param) filter.run_id = run_id_param;
    const chat_id = url.searchParams.get("chat_id");
    if (chat_id) filter.chat_id = chat_id;
    const team_id = get_filter_team_id(ctx);
    if (team_id !== undefined) filter.team_id = team_id;
    json(res, 200, await options.events.list(filter));
    return true;
  }

  // Tools API
  if (url.pathname === "/api/tools" && req.method === "GET") {
    const ops = options.tool_ops;
    if (!ops) { json(res, 503, { error: "tools_unavailable" }); return true; }
    json(res, 200, {
      names: ops.tool_names(),
      definitions: ops.get_definitions(),
      mcp_servers: ops.list_mcp_servers(),
      native_tools: CLAUDE_CODE_NATIVE_TOOLS,
    });
    return true;
  }

  // healthz
  if (url.pathname === "/healthz") {
    json(res, 200, { ok: true, at: now_iso() });
    return true;
  }

  return false;
}
