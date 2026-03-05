import type { RouteContext } from "../route-context.js";

export async function handle_cron(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  // GET /api/cron/jobs
  if (url.pathname === "/api/cron/jobs" && req.method === "GET") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const include_disabled = url.searchParams.get("include_disabled") === "1";
    json(res, 200, await cron.list_jobs(include_disabled));
    return true;
  }

  // GET /api/cron/status
  if (url.pathname === "/api/cron/status" && req.method === "GET") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    json(res, 200, await cron.status());
    return true;
  }

  if (url.pathname !== "/api/cron") return false;

  // POST /api/cron { action, job_id, ... } — enable/run/pause/resume
  if (req.method === "POST") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const body = await read_body(req);
    const action = String(body?.action || "").trim();

    if (action === "enable") {
      const job_id = String(body?.job_id || "").trim();
      if (!job_id) { json(res, 400, { error: "job_id_required" }); return true; }
      const enabled = body?.enabled !== false;
      const job = await cron.enable_job(job_id, enabled);
      json(res, job ? 200 : 404, job ?? { error: "not_found" });
      return true;
    }
    if (action === "run") {
      const job_id = String(body?.job_id || "").trim();
      if (!job_id) { json(res, 400, { error: "job_id_required" }); return true; }
      const force = body?.force === true;
      const ok = await cron.run_job(job_id, force);
      json(res, ok ? 200 : 404, { ok });
      return true;
    }
    if (action === "pause") {
      await cron.pause();
      json(res, 200, { ok: true });
      return true;
    }
    if (action === "resume") {
      await cron.resume();
      json(res, 200, { ok: true });
      return true;
    }

    json(res, 400, { error: "unknown_action" });
    return true;
  }

  // DELETE /api/cron { job_id } — 삭제
  if (req.method === "DELETE") {
    const cron = options.cron;
    if (!cron) { json(res, 503, { error: "cron_unavailable" }); return true; }
    const body = await read_body(req);
    const job_id = String(body?.job_id || "").trim();
    if (!job_id) { json(res, 400, { error: "job_id_required" }); return true; }
    const removed = await cron.remove_job(job_id);
    json(res, removed ? 200 : 404, { removed });
    return true;
  }

  return false;
}
