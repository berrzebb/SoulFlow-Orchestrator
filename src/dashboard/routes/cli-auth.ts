/** CLI 에이전트 인증 상태 조회 API 라우트. 로그인은 CLI에서 직접 수행. */

import type { RouteContext } from "../route-context.js";

function cli_auth_ops_or_503(ctx: RouteContext) {
  const ops = ctx.options.cli_auth_ops ?? null;
  if (!ops) ctx.json(ctx.res, 503, { error: "cli_auth_unavailable" });
  return ops;
}

export async function handle_cli_auth(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body } = ctx;
  const ops = cli_auth_ops_or_503(ctx);
  const path = url.pathname;

  // GET /api/auth/cli/status
  if (path === "/api/auth/cli/status" && req.method === "GET") {
    if (!ops) return true;
    json(res, 200, ops.get_status());
    return true;
  }

  // POST /api/auth/cli/check — body.cli 있으면 단일, 없으면 전체
  if (path === "/api/auth/cli/check" && req.method === "POST") {
    if (!ops) return true;
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

  return false;
}
