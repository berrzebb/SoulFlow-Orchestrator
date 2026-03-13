import type { RouteContext } from "../route-context.js";
import { get_filter_team_id } from "../route-context.js";

/** 비superadmin 사용자의 시크릿 키에 team prefix 추가. */
function scoped_name(team_id: string | undefined, name: string): string {
  return team_id !== undefined ? `team:${team_id}:${name}` : name;
}

/** team prefix가 있으면 strip하여 사용자에게 보여줄 이름 반환. */
function strip_prefix(prefix: string, full_name: string): string {
  return full_name.startsWith(prefix) ? full_name.slice(prefix.length) : full_name;
}

export async function handle_secret(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;
  const team_id = get_filter_team_id(ctx);

  // GET /api/secrets
  if (path === "/api/secrets" && req.method === "GET") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const all_names = await vault.list_names();
    if (team_id === undefined) {
      // superadmin / 싱글 유저 모드 → 모든 시크릿 원본 이름 표시
      json(res, 200, { names: all_names });
    } else {
      // 팀 사용자 → 자기 팀 시크릿만 필터 + prefix strip
      const prefix = `team:${team_id}:`;
      const names = all_names
        .filter((n) => n.startsWith(prefix))
        .map((n) => strip_prefix(prefix, n));
      json(res, 200, { names });
    }
    return true;
  }

  // POST /api/secrets { name, value }
  if (path === "/api/secrets" && req.method === "POST") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    const value = String(body?.value ?? "");
    if (!name) { json(res, 400, { error: "name_required" }); return true; }
    const result = await vault.put_secret(scoped_name(team_id, name), value);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/secrets/:name
  const del_match = path.match(/^\/api\/secrets\/([^/]+)$/);
  if (del_match && req.method === "DELETE") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const name = decodeURIComponent(del_match[1]);
    const removed = await vault.remove_secret(scoped_name(team_id, name));
    json(res, removed ? 200 : 404, { removed });
    return true;
  }

  return false;
}
