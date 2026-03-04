import type { RouteContext } from "../route-context.js";

export async function handle_state(ctx: RouteContext): Promise<boolean> {
  const { url, res, json, add_sse_client, build_state, metrics } = ctx;

  if (url.pathname === "/api/system-metrics") {
    json(res, 200, metrics.get_latest() ?? {});
    return true;
  }
  if (url.pathname === "/api/state") {
    json(res, 200, await build_state());
    return true;
  }
  if (url.pathname === "/api/events") {
    add_sse_client(res);
    return true;
  }

  return false;
}
