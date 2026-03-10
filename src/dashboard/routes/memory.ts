import type { RouteContext } from "../route-context.js";

function memory_ops_or_503(ctx: RouteContext) {
  const ops = ctx.options.memory_ops ?? null;
  if (!ops) ctx.json(ctx.res, 503, { error: "memory_unavailable" });
  return ops;
}

export async function handle_memory(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/memory/longterm
  if (path === "/api/memory/longterm" && req.method === "GET") {
    const mem = memory_ops_or_503(ctx);
    if (!mem) return true;
    const content = await mem.read_longterm();
    json(res, 200, { content });
    return true;
  }
  // PUT /api/memory/longterm { content }
  if (path === "/api/memory/longterm" && req.method === "PUT") {
    const mem = memory_ops_or_503(ctx);
    if (!mem) return true;
    const body = await read_body(req);
    const content = String(body?.content ?? "");
    await mem.write_longterm(content);
    json(res, 200, { ok: true });
    return true;
  }

  // GET /api/memory/daily
  if (path === "/api/memory/daily" && req.method === "GET") {
    const mem = memory_ops_or_503(ctx);
    if (!mem) return true;
    const days = await mem.list_daily();
    json(res, 200, { days });
    return true;
  }

  // GET /api/memory/daily/:day
  const day_match = path.match(/^\/api\/memory\/daily\/([^/]+)$/);
  if (day_match && req.method === "GET") {
    const mem = memory_ops_or_503(ctx);
    if (!mem) return true;
    const day = decodeURIComponent(day_match[1]);
    const content = await mem.read_daily(day);
    json(res, 200, { content, day });
    return true;
  }

  // PUT /api/memory/daily/:day { content }
  if (day_match && req.method === "PUT") {
    const mem = memory_ops_or_503(ctx);
    if (!mem) return true;
    const day = decodeURIComponent(day_match[1]);
    const body = await read_body(req);
    const content = String(body?.content ?? "");
    await mem.write_daily(content, day);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
