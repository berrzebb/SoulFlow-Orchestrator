/** CLI 에이전트(Claude Code, Codex) 인증 관리 API 라우트. */

import type { RouteContext } from "../route-context.js";

function cli_auth_ops_or_503(ctx: RouteContext) {
  const ops = ctx.options.cli_auth_ops ?? null;
  if (!ops) ctx.json(ctx.res, 503, { error: "cli_auth_unavailable" });
  return ops;
}

export async function handle_cli_auth(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, resolve_request_origin } = ctx;
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

  // GET /api/auth/cli/sessions/:cli — 로그인 진행 상태 폴링
  const progress_match = path.match(/^\/api\/auth\/cli\/sessions\/([^/]+)$/);
  if (progress_match && req.method === "GET") {
    if (!ops) return true;
    const cli = decodeURIComponent(progress_match[1]);
    const progress = ops.get_login_progress(cli);
    json(res, progress ? 200 : 404, progress ?? { error: "no active login" });
    return true;
  }

  // POST /api/auth/cli/sessions { cli } — 로그인 시작
  if (path === "/api/auth/cli/sessions" && req.method === "POST") {
    if (!ops) return true;
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
    if (!ops) return true;
    const cli = decodeURIComponent(cancel_match[1]);
    json(res, 200, ops.cancel_login(cli));
    return true;
  }

  // GET /api/auth/cli/oauth-proxy/:cli — localhost OAuth 서버 프록시 (redirect_uri 재작성)
  const proxy_match = path.match(/^\/api\/auth\/cli\/oauth-proxy\/([^/]+)$/);
  if (proxy_match && req.method === "GET") {
    if (!ops) return true;
    const cli = decodeURIComponent(proxy_match[1]);
    const port = ops.get_oauth_port(cli);
    if (!port) { json(res, 404, { error: "no active oauth session" }); return true; }

    try {
      const origin = resolve_request_origin(req);
      const callback_url = `${origin}/api/auth/cli/oauth-callback/${encodeURIComponent(cli)}`;
      // 저장된 원본 URL에서 경로+쿼리 복원 (예: /oauth/start) — 없으면 "/" 사용
      const local_url = ops.get_oauth_local_url(cli);
      const target_path = (() => {
        if (!local_url) return url.search || "/";
        try { const u = new URL(local_url); return u.pathname + u.search; }
        catch { return "/"; }
      })();
      const target_res = await fetch(`http://localhost:${port}${target_path}`);

      if (target_res.status >= 300 && target_res.status < 400) {
        // redirect_uri 재작성: OAuth provider가 콜백을 dashboard로 보내게 함
        let location = target_res.headers.get("location") || "";
        location = rewrite_redirect_uri(location, callback_url);
        res.writeHead(302, { "Location": location, "Cache-Control": "no-store" });
        res.end();
      } else {
        // HTML 응답이면 그대로 전달 (추가 리다이렉트 처리 포함)
        const content_type = target_res.headers.get("content-type") || "text/html";
        const body_text = await target_res.text();
        const rewritten = body_text.replace(
          /href="(https?:\/\/[^"]*redirect_uri=[^"]+)"/g,
          (_, href) => `href="${rewrite_redirect_uri(href, callback_url)}"`,
        );
        res.writeHead(target_res.status, { "Content-Type": content_type, "Cache-Control": "no-store" });
        res.end(rewritten);
      }
    } catch {
      json(res, 502, { error: "oauth_server_unreachable" });
    }
    return true;
  }

  // GET /api/auth/cli/oauth-callback/:cli — OAuth 콜백 수신 후 CLI 서버로 포워드
  const callback_match = path.match(/^\/api\/auth\/cli\/oauth-callback\/([^/]+)$/);
  if (callback_match && req.method === "GET") {
    if (!ops) return true;
    const cli = decodeURIComponent(callback_match[1]);
    const port = ops.get_oauth_port(cli);
    if (!port) { json(res, 404, { error: "no active oauth session" }); return true; }

    try {
      const forward_url = `http://localhost:${port}/callback${url.search || ""}`;
      const target_res = await fetch(forward_url);
      const content_type = target_res.headers.get("content-type") || "text/html";

      if (target_res.status >= 300 && target_res.status < 400) {
        // CLI가 성공 페이지로 리다이렉트 — 대신 완료 페이지 표시
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauth_done_html(cli));
      } else {
        const body_text = await target_res.text();
        res.writeHead(target_res.status, { "Content-Type": content_type });
        res.end(body_text);
      }
    } catch {
      // CLI가 이미 토큰을 처리하고 종료했을 수 있음 — 성공으로 간주
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(oauth_done_html(cli));
    }
    return true;
  }

  return false;
}

/** URL의 redirect_uri 파라미터를 새 값으로 재작성. */
function rewrite_redirect_uri(url_str: string, new_redirect_uri: string): string {
  try {
    const u = new URL(url_str);
    if (u.searchParams.has("redirect_uri")) {
      u.searchParams.set("redirect_uri", new_redirect_uri);
      return u.toString();
    }
  } catch { /* URL 파싱 실패 시 원본 반환 */ }
  return url_str;
}

function oauth_done_html(cli: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login Complete</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f0f0f;color:#e0e0e0}
.box{text-align:center;padding:2rem;border:1px solid #333;border-radius:8px;max-width:400px}
h2{color:#4caf50;margin-bottom:1rem}p{color:#aaa;margin-bottom:1.5rem}
button{background:#1976d2;color:#fff;border:none;padding:.6rem 1.2rem;border-radius:4px;cursor:pointer;font-size:1rem}
button:hover{background:#1565c0}</style></head>
<body><div class="box"><h2>✓ Login Complete</h2>
<p>${cli} authentication successful. You can close this tab.</p>
<button onclick="window.close()">Close</button></div></body></html>`;
}
