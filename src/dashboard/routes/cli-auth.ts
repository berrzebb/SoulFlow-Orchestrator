/** CLI 에이전트(Claude Code, Codex) 인증 관리 API 라우트. */

import type { RouteContext } from "../route-context.js";

export async function handle_cli_auth(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const ops = options.cli_auth_ops;
  const path = url.pathname;

  // GET /api/auth/cli/status
  if (path === "/api/auth/cli/status" && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    json(res, 200, ops.get_status());
    return true;
  }

  // POST /api/auth/cli/check — body.cli 있으면 단일, 없으면 전체
  if (path === "/api/auth/cli/check" && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const body = await read_body(req);
    const cli = String(body?.cli || "").trim();
    if (cli) {
      const status = await ops.check(cli);
      json(res, 200, status);
    } else {
      const statuses = await ops.check_all();
      json(res, 200, statuses);
    }
    return true;
  }

  // POST /api/auth/cli/sessions { cli } — 로그인 시작
  if (path === "/api/auth/cli/sessions" && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const body = await read_body(req);
    const cli = String(body?.cli || "");
    if (!cli) { json(res, 400, { error: "missing cli field" }); return true; }
    const result = await ops.start_login(cli);
    json(res, 200, result);
    return true;
  }

  // DELETE /api/auth/cli/sessions/:cli — 로그인 취소
  const cancel_match = path.match(/^\/api\/auth\/cli\/sessions\/([^/]+)$/);
  if (cancel_match && req.method === "DELETE") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const cli = decodeURIComponent(cancel_match[1]);
    json(res, 200, ops.cancel_login(cli));
    return true;
  }

  return false;
}
