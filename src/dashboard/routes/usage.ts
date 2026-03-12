import type { RouteContext } from "../route-context.js";
import { get_all_pricing } from "../../gateway/cost-table.js";

export async function handle_usage(ctx: RouteContext): Promise<boolean> {
  const { url, res, options, json } = ctx;
  const usage = options.usage_ops;

  if (!url.pathname.startsWith("/api/usage")) return false;

  if (!usage) {
    json(res, 503, { error: "usage_tracking_unavailable" });
    return true;
  }

  // GET /api/usage/spans
  if (url.pathname === "/api/usage/spans" && ctx.req.method === "GET") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
    const spans = await usage.list_spans({
      provider_id: url.searchParams.get("provider_id") ?? undefined,
      chat_id: url.searchParams.get("chat_id") ?? undefined,
      since: url.searchParams.get("since") ?? undefined,
      limit,
    });
    json(res, 200, spans);
    return true;
  }

  // GET /api/usage/summary/daily
  if (url.pathname === "/api/usage/summary/daily" && ctx.req.method === "GET") {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") || 30)));
    json(res, 200, await usage.get_daily_summary(days));
    return true;
  }

  // GET /api/usage/summary/provider
  if (url.pathname === "/api/usage/summary/provider" && ctx.req.method === "GET") {
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") || 30)));
    json(res, 200, await usage.get_provider_summary(days));
    return true;
  }

  // GET /api/usage/pricing
  if (url.pathname === "/api/usage/pricing" && ctx.req.method === "GET") {
    json(res, 200, get_all_pricing());
    return true;
  }

  return false;
}
