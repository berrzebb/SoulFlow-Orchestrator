import type { RouteContext } from "../route-context.js";

function cron_or_503(ctx: RouteContext) {
  const cron = ctx.options.cron ?? null;
  if (!cron) ctx.json(ctx.res, 503, { error: "cron_unavailable" });
  return cron;
}

export async function handle_cron(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/cron/jobs
  if (path === "/api/cron/jobs" && req.method === "GET") {
    const cron = cron_or_503(ctx);
    if (!cron) return true;
    const include_disabled = url.searchParams.get("include_disabled") === "1";
    json(res, 200, await cron.list_jobs(include_disabled));
    return true;
  }

  // GET /api/cron/status
  if (path === "/api/cron/status" && req.method === "GET") {
    const cron = cron_or_503(ctx);
    if (!cron) return true;
    json(res, 200, await cron.status());
    return true;
  }

  // PUT /api/cron/status { paused } — 스케줄러 일시정지/재개
  if (path === "/api/cron/status" && req.method === "PUT") {
    const cron = cron_or_503(ctx);
    if (!cron) return true;
    const body = await read_body(req);
    if (body?.paused === true) {
      await cron.pause();
    } else {
      await cron.resume();
    }
    json(res, 200, { ok: true });
    return true;
  }

  // PUT /api/cron/jobs/:id { enabled, force? } — 활성화/비활성화
  const job_match = path.match(/^\/api\/cron\/jobs\/([^/]+)$/);
  if (job_match && req.method === "PUT") {
    const cron = cron_or_503(ctx);
    if (!cron) return true;
    const job_id = decodeURIComponent(job_match[1]);
    const body = await read_body(req);
    const enabled = body?.enabled !== false;
    const job = await cron.enable_job(job_id, enabled);
    json(res, job ? 200 : 404, job ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/cron/jobs/:id
  if (job_match && req.method === "DELETE") {
    const cron = cron_or_503(ctx);
    if (!cron) return true;
    const job_id = decodeURIComponent(job_match[1]);
    const removed = await cron.remove_job(job_id);
    json(res, removed ? 200 : 404, { removed });
    return true;
  }

  // POST /api/cron/jobs/:id/runs { force? } — 즉시 실행
  const run_match = path.match(/^\/api\/cron\/jobs\/([^/]+)\/runs$/);
  if (run_match && req.method === "POST") {
    const cron = cron_or_503(ctx);
    if (!cron) return true;
    const job_id = decodeURIComponent(run_match[1]);
    const body = await read_body(req);
    const force = body?.force === true;
    const ok = await cron.run_job(job_id, force);
    json(res, ok ? 200 : 404, { ok });
    return true;
  }

  return false;
}
