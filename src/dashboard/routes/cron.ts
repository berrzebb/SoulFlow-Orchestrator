import type { RouteContext } from "../route-context.js";

export async function handle_cron(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/cron/jobs" && req.method === "GET") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const include_disabled = url.searchParams.get("include_disabled") === "1";
    json(res, 200, await cron.list_jobs(include_disabled));
    return true;
  }
  if (url.pathname === "/api/cron/status" && req.method === "GET") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    json(res, 200, await cron.status());
    return true;
  }
  const enable_match = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)\/enable$/);
  if (req.method === "POST" && enable_match) {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const body = await read_body(req);
    const enabled = body?.enabled !== false;
    const job = await cron.enable_job(enable_match[1], enabled);
    json(res, job ? 200 : 404, job ?? { error: "not_found" });
    return true;
  }
  const run_match = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)\/run$/);
  if (req.method === "POST" && run_match) {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const body = await read_body(req);
    const force = body?.force === true;
    const ok = await cron.run_job(run_match[1], force);
    json(res, ok ? 200 : 404, { ok });
    return true;
  }
  const delete_match = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)$/);
  if (req.method === "DELETE" && delete_match) {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const removed = await cron.remove_job(delete_match[1]);
    json(res, removed ? 200 : 404, { removed });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/cron/pause") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    await cron.pause();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/cron/resume") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    await cron.resume();
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
