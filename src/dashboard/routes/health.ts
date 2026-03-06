import { now_iso } from "../../utils/common.js";
import type { RouteContext } from "../route-context.js";

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

  // DLQ API
  if (url.pathname === "/api/dlq" && req.method === "GET") {
    const dlq = options.dlq;
    if (!dlq) { json(res, 503, { error: "dlq_unavailable" }); return true; }
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    json(res, 200, await dlq.list(limit));
    return true;
  }

  // Workflow Events API
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
