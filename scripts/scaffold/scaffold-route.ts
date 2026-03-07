#!/usr/bin/env tsx
/**
 * 대시보드 라우트 스캐폴드 생성기.
 *
 * Usage:
 *   npx tsx scripts/scaffold/scaffold-route.ts <name> [options]
 *   npx tsx scripts/scaffold/scaffold-route.ts notification --endpoints "GET /api/notifications,POST /api/notifications"
 *   npx tsx scripts/scaffold/scaffold-route.ts notification --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ROUTES_DIR = resolve(ROOT, "src/dashboard/routes");
const SERVICE_FILE = resolve(ROOT, "src/dashboard/service.ts");

// ── CLI parsing ──

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: npx tsx scripts/scaffold/scaffold-route.ts <name> [options]

Options:
  --endpoints <spec>  Endpoints: "GET /api/items,POST /api/items,DELETE /api/items/:id"
  --ops <iface>       Ops interface name (default: auto-generated)
  --dry-run           Preview without writing files`);
  process.exit(0);
}

const name = args[0]!;
if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
  console.error(`Error: name must be lowercase kebab/snake (got "${name}")`);
  process.exit(1);
}

function get_opt(flag: string, fallback: string): string {
  const idx = args.indexOf(`--${flag}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
}

const endpoints_raw = get_opt("endpoints", `GET /api/${name}s`);
const ops_name_raw = get_opt("ops", "");
const DRY_RUN = args.includes("--dry-run");

// ── Parse endpoints ──

type EndpointSpec = { method: string; path: string; has_param: boolean; param_name?: string };

function parse_endpoints(spec: string): EndpointSpec[] {
  return spec.split(",").map((s) => {
    const trimmed = s.trim();
    const space_idx = trimmed.indexOf(" ");
    const method = space_idx >= 0 ? trimmed.slice(0, space_idx).toUpperCase() : "GET";
    const path = space_idx >= 0 ? trimmed.slice(space_idx + 1).trim() : trimmed;
    const param_match = path.match(/:([a-z_]+)/);
    return {
      method,
      path: param_match ? path.replace(/:([a-z_]+)/, "([^/]+)") : path,
      has_param: !!param_match,
      param_name: param_match?.[1],
    };
  });
}

const endpoints = parse_endpoints(endpoints_raw);

// ── Name helpers ──

const file_name = name.replace(/_/g, "-");
const route_path = resolve(ROUTES_DIR, `${file_name}.ts`);
const handler_fn = `handle_${name.replace(/-/g, "_")}`;
const pascal = name.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const ops_iface = ops_name_raw || `Dashboard${pascal}Ops`;

// ── 1. Generate route handler ──

function gen_route(): string {
  const lines: string[] = [];
  lines.push(`import type { RouteContext } from "../route-context.js";`);
  lines.push("");
  lines.push(`export async function ${handler_fn}(ctx: RouteContext): Promise<boolean> {`);
  lines.push(`  const { req, url, res, options, json, read_body } = ctx;`);
  lines.push(`  const path = url.pathname;`);
  lines.push("");

  for (const ep of endpoints) {
    if (ep.has_param) {
      const regex_pattern = `^${ep.path.replace(/\//g, "\\/")}$`;
      lines.push(`  // ${ep.method} ${ep.path}`);
      lines.push(`  const match_${ep.param_name} = path.match(/${regex_pattern}/);`);
      lines.push(`  if (match_${ep.param_name} && req.method === "${ep.method}") {`);
      lines.push(`    const ${ep.param_name} = decodeURIComponent(match_${ep.param_name}[1]);`);
      lines.push(`    // TODO: implement`);
      lines.push(`    json(res, 200, { ${ep.param_name} });`);
      lines.push(`    return true;`);
      lines.push(`  }`);
    } else {
      lines.push(`  // ${ep.method} ${ep.path}`);
      lines.push(`  if (path === "${ep.path}" && req.method === "${ep.method}") {`);
      if (ep.method === "POST" || ep.method === "PUT" || ep.method === "PATCH") {
        lines.push(`    const body = await read_body(req);`);
        lines.push(`    // TODO: implement`);
        lines.push(`    json(res, 200, { ok: true });`);
      } else if (ep.method === "DELETE") {
        lines.push(`    // TODO: implement`);
        lines.push(`    json(res, 200, { ok: true });`);
      } else {
        lines.push(`    // TODO: implement`);
        lines.push(`    json(res, 200, { items: [] });`);
      }
      lines.push(`    return true;`);
      lines.push(`  }`);
    }
    lines.push("");
  }

  lines.push(`  return false;`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

// ── 2. Patch service.ts ──

function patch_service(src: string): string {
  let patched = src;

  // import 삽입: 마지막 handle_ import 뒤
  const import_line = `import { ${handler_fn} } from "./routes/${file_name}.js";`;
  const last_handle_import_re = /^import .* from "\.\/routes\/[^"]+\.js";$/gm;
  let last_match: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = last_handle_import_re.exec(patched)) !== null) last_match = m;
  if (last_match) {
    const pos = last_match.index + last_match[0].length;
    patched = patched.slice(0, pos) + "\n" + import_line + patched.slice(pos);
  }

  // route_map 등록: 마지막 route_map.set 뒤
  // 첫 번째 endpoint의 path를 prefix로 사용
  const primary_path = endpoints[0]?.path.replace(/\([^)]+\)/g, "") || `/api/${name}s`;
  const route_line = `    this.route_map.set("${primary_path}", ${handler_fn});`;
  const last_route_re = /this\.route_map\.set\("[^"]+", \w+\);/g;
  last_match = null;
  while ((m = last_route_re.exec(patched)) !== null) last_match = m;
  if (last_match) {
    const pos = last_match.index + last_match[0].length;
    patched = patched.slice(0, pos) + "\n" + route_line + patched.slice(pos);
  }

  return patched;
}

// ── Execute ──

if (existsSync(route_path)) {
  console.error(`Error: ${route_path} already exists`);
  process.exit(1);
}

const service_src = readFileSync(SERVICE_FILE, "utf-8");
if (service_src.includes(handler_fn)) {
  console.error(`Error: ${handler_fn} already registered in service.ts`);
  process.exit(1);
}

const route_content = gen_route();
const patched_service = patch_service(service_src);

if (DRY_RUN) {
  console.log("[dry-run] Would create:", route_path);
  console.log("[dry-run] Would patch: dashboard/service.ts (+import, +route_map)");
  console.log(`[dry-run] Endpoints: ${endpoints.map((e) => `${e.method} ${e.path}`).join(", ")}`);
  console.log("\n--- Generated route ---\n" + route_content);
} else {
  writeFileSync(route_path, route_content, "utf-8");
  writeFileSync(SERVICE_FILE, patched_service, "utf-8");
  console.log(`Created: src/dashboard/routes/${file_name}.ts`);
  console.log(`Patched: dashboard/service.ts (+import, +route_map)`);
}
