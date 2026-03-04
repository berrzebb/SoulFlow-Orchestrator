import type { RouteContext } from "../route-context.js";

export async function handle_memory(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/memory/longterm" && req.method === "GET") {
    if (!options.memory_ops) { json(res, 503, { error: "memory_unavailable" }); return true; }
    const content = await options.memory_ops.read_longterm();
    json(res, 200, { content });
    return true;
  }
  if (url.pathname === "/api/memory/longterm" && req.method === "PUT") {
    if (!options.memory_ops) { json(res, 503, { error: "memory_unavailable" }); return true; }
    const body = await read_body(req);
    const content = String(body?.content ?? "");
    await options.memory_ops.write_longterm(content);
    json(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/memory/daily" && req.method === "GET") {
    if (!options.memory_ops) { json(res, 503, { error: "memory_unavailable" }); return true; }
    const days = await options.memory_ops.list_daily();
    json(res, 200, { days });
    return true;
  }
  const daily_match = url.pathname.match(/^\/api\/memory\/daily\/([^/]+)$/);
  if (daily_match && req.method === "GET") {
    if (!options.memory_ops) { json(res, 503, { error: "memory_unavailable" }); return true; }
    const day = decodeURIComponent(daily_match[1]);
    const content = await options.memory_ops.read_daily(day);
    json(res, 200, { content, day });
    return true;
  }
  if (daily_match && req.method === "PUT") {
    if (!options.memory_ops) { json(res, 503, { error: "memory_unavailable" }); return true; }
    const day = decodeURIComponent(daily_match[1]);
    const body = await read_body(req);
    const content = String(body?.content ?? "");
    await options.memory_ops.write_daily(content, day);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
