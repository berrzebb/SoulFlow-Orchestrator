/** CLI 에이전트(Claude Code, Codex) 인증 관리 API 라우트. */

import type { RouteContext } from "../route-context.js";

export async function handle_cli_auth(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const ops = options.cli_auth_ops;

  // GET /api/cli-auth/status — 캐시된 인증 상태 반환
  if (url.pathname === "/api/cli-auth/status" && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    json(res, 200, ops.get_status());
    return true;
  }

  // POST /api/cli-auth/check — 인증 상태 재확인 (CLI 호출)
  if (url.pathname === "/api/cli-auth/check" && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const body = await read_body(req);
    const cli = String(body?.cli || "");
    if (!cli) { json(res, 400, { error: "missing cli field" }); return true; }
    const status = await ops.check(cli);
    json(res, 200, status);
    return true;
  }

  // POST /api/cli-auth/check-all — 모든 CLI 인증 상태 재확인
  if (url.pathname === "/api/cli-auth/check-all" && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const statuses = await ops.check_all();
    json(res, 200, statuses);
    return true;
  }

  // POST /api/cli-auth/login — OAuth 로그인 시작 → login_url 반환
  if (url.pathname === "/api/cli-auth/login" && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const body = await read_body(req);
    const cli = String(body?.cli || "");
    if (!cli) { json(res, 400, { error: "missing cli field" }); return true; }
    const result = await ops.start_login(cli);
    json(res, 200, result);
    return true;
  }

  // POST /api/cli-auth/cancel — 진행 중인 로그인 취소
  if (url.pathname === "/api/cli-auth/cancel" && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "cli_auth_unavailable" }); return true; }
    const body = await read_body(req);
    const cli = String(body?.cli || "");
    if (!cli) { json(res, 400, { error: "missing cli field" }); return true; }
    json(res, 200, ops.cancel_login(cli));
    return true;
  }

  return false;
}
