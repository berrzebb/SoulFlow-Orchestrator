import type { RouteContext } from "../route-context.js";
import { get_filter_team_id, require_team_manager } from "../route-context.js";

export async function handle_state(ctx: RouteContext): Promise<boolean> {
  const { url, res, json, add_sse_client, build_state, metrics } = ctx;

  // FE-6a: 시스템 메트릭은 team_manager 이상만 접근
  if (url.pathname === "/api/system/metrics") {
    if (!require_team_manager(ctx)) return true;
    json(res, 200, metrics.get_latest() ?? {});
    return true;
  }
  if (url.pathname === "/api/state") {
    json(res, 200, await build_state(get_filter_team_id(ctx)));
    return true;
  }
  if (url.pathname === "/api/events") {
    add_sse_client(res, get_filter_team_id(ctx));
    return true;
  }

  return false;
}
