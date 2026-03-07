#!/usr/bin/env tsx
/**
 * 프론트엔드 페이지 스캐폴드 생성기.
 *
 * Usage:
 *   npx tsx scripts/scaffold/scaffold-page.ts <name> [options]
 *   npx tsx scripts/scaffold/scaffold-page.ts notifications --group system --icon "🔔"
 *   npx tsx scripts/scaffold/scaffold-page.ts notifications --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PAGES_DIR = resolve(ROOT, "web/src/pages");
const ROUTER_FILE = resolve(ROOT, "web/src/router.tsx");
const SIDEBAR_FILE = resolve(ROOT, "web/src/layouts/sidebar.tsx");
const EN_JSON = resolve(ROOT, "src/i18n/locales/en.json");
const KO_JSON = resolve(ROOT, "src/i18n/locales/ko.json");

// ── CLI parsing ──

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: npx tsx scripts/scaffold/scaffold-page.ts <name> [options]

Options:
  --group <group>    Sidebar nav group: main|build|connect|system (default: system)
  --icon <char>      Unicode icon (default: ◇)
  --title <text>     Page title (default: auto from name)
  --no-sidebar       Skip sidebar registration
  --dry-run          Preview without writing files`);
  process.exit(0);
}

const name = args[0]!;
if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(`Error: name must be lowercase kebab-case (got "${name}")`);
  process.exit(1);
}

function get_opt(flag: string, fallback: string): string {
  const idx = args.indexOf(`--${flag}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
}

const group = get_opt("group", "system");
const icon = get_opt("icon", "\u25c7");
const title_raw = get_opt("title", "");
const NO_SIDEBAR = args.includes("--no-sidebar");
const DRY_RUN = args.includes("--dry-run");

const VALID_GROUPS = ["main", "build", "connect", "system"];
if (!VALID_GROUPS.includes(group)) {
  console.error(`Error: group must be one of: ${VALID_GROUPS.join(", ")} (got "${group}")`);
  process.exit(1);
}

// ── Name helpers ──

const pascal = name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const component_name = `${pascal}Page`;
const page_path = resolve(PAGES_DIR, `${name}.tsx`);
const human_title = title_raw || name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const nav_key = `nav.${name.replace(/-/g, "_")}`;
const group_key = `nav.group.${group}`;

// ── 1. Generate page component ──

const page_content = `import { useT } from "../i18n";

export default function ${component_name}() {
  const t = useT();

  return (
    <div className="page">
      <h2 className="page__title">{t("${nav_key}")}</h2>
      {/* TODO: implement */}
    </div>
  );
}
`;

// ── 2. Patch router.tsx ──

function patch_router(src: string): string {
  // lazy import 삽입: 마지막 lazyRetry import 뒤
  const lazy_line = `const ${component_name} = lazyRetry(() => import("./pages/${name}"));`;
  const last_lazy_re = /^const \w+ = lazyRetry\(.+\);$/gm;
  let last_match: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = last_lazy_re.exec(src)) !== null) last_match = m;
  let patched = src;
  if (last_match) {
    const pos = last_match.index + last_match[0].length;
    patched = patched.slice(0, pos) + "\n" + lazy_line + patched.slice(pos);
  }

  // route 등록: children 배열의 마지막 route 뒤
  const route_line = `      { path: "${name}", element: lazify(<${component_name} />) },`;
  const last_route_re = /\{ path: "[^"]+", element: lazify\(<\w+ \/>\) \},/g;
  last_match = null;
  while ((m = last_route_re.exec(patched)) !== null) last_match = m;
  if (last_match) {
    const pos = last_match.index + last_match[0].length;
    patched = patched.slice(0, pos) + "\n" + route_line + patched.slice(pos);
  }

  return patched;
}

// ── 3. Patch sidebar.tsx ──

function patch_sidebar(src: string): string {
  // 해당 group의 items 배열에 추가
  const nav_item = `      { to: "/${name}", key: "${nav_key}", icon: "${icon}" },`;

  // group_key로 해당 그룹 찾기
  const group_re = new RegExp(`label_key: "${group_key}",\\s*items: \\[([^\\]]*?)\\]`, "s");
  const match = src.match(group_re);
  if (!match) {
    console.error(`Warning: could not find nav group "${group_key}" in sidebar.tsx`);
    return src;
  }

  // items 배열의 마지막 항목 뒤에 삽입
  const items_content = match[1];
  const last_item_re = /\{ to: "[^"]+", key: "[^"]+", icon: "[^"]+" \},?/g;
  let last_item_match: RegExpExecArray | null = null;
  let im: RegExpExecArray | null;
  while ((im = last_item_re.exec(items_content!)) !== null) last_item_match = im;
  if (last_item_match) {
    const abs_pos = match.index! + match[0].indexOf(items_content!) + last_item_match.index + last_item_match[0].length;
    return src.slice(0, abs_pos) + "\n" + nav_item + src.slice(abs_pos);
  }

  return src;
}

// ── 4. Patch i18n JSON ──

function patch_json(json_path: string, keys: Record<string, string>): string {
  const data: Record<string, string> = JSON.parse(readFileSync(json_path, "utf-8"));
  for (const [k, v] of Object.entries(keys)) {
    if (!(k in data)) data[k] = v;
  }
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted, null, 2) + "\n";
}

function build_i18n_keys(lang: "en" | "ko"): Record<string, string> {
  const keys: Record<string, string> = {};
  keys[nav_key] = lang === "en" ? human_title : `TODO_${name}`;
  return keys;
}

// ── Execute ──

if (existsSync(page_path)) {
  console.error(`Error: ${page_path} already exists`);
  process.exit(1);
}

const router_src = readFileSync(ROUTER_FILE, "utf-8");
if (router_src.includes(component_name)) {
  console.error(`Error: ${component_name} already exists in router.tsx`);
  process.exit(1);
}

const patched_router = patch_router(router_src);
const patched_sidebar = NO_SIDEBAR ? null : patch_sidebar(readFileSync(SIDEBAR_FILE, "utf-8"));
const patched_en = patch_json(EN_JSON, build_i18n_keys("en"));
const patched_ko = patch_json(KO_JSON, build_i18n_keys("ko"));

if (DRY_RUN) {
  console.log("[dry-run] Would create:", page_path);
  console.log("[dry-run] Would patch: router.tsx (+lazy import, +route)");
  if (!NO_SIDEBAR) console.log(`[dry-run] Would patch: sidebar.tsx (+nav item in ${group})`);
  console.log("[dry-run] i18n keys:", Object.keys(build_i18n_keys("en")).join(", "));
  console.log("\n--- Generated page ---\n" + page_content);
} else {
  writeFileSync(page_path, page_content, "utf-8");
  writeFileSync(ROUTER_FILE, patched_router, "utf-8");
  if (patched_sidebar) writeFileSync(SIDEBAR_FILE, patched_sidebar, "utf-8");
  writeFileSync(EN_JSON, patched_en, "utf-8");
  writeFileSync(KO_JSON, patched_ko, "utf-8");
  console.log(`Created: web/src/pages/${name}.tsx`);
  console.log(`Patched: router.tsx (+lazy import, +route)`);
  if (!NO_SIDEBAR) console.log(`Patched: sidebar.tsx (+nav item in ${group})`);
  console.log(`Patched: en.json, ko.json (+${Object.keys(build_i18n_keys("en")).length} keys each)`);
}
