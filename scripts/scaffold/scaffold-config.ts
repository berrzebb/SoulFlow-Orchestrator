#!/usr/bin/env tsx
/**
 * Config 필드 스캐폴드 생성기.
 *
 * Usage:
 *   npx tsx scripts/scaffold/scaffold-config.ts <path> [options]
 *   npx tsx scripts/scaffold/scaffold-config.ts notification.cooldownMs --section general --type number --default 5000 --desc "Cooldown between notifications"
 *   npx tsx scripts/scaffold/scaffold-config.ts notification.cooldownMs --dry-run
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const META_FILE = resolve(ROOT, "src/config/config-meta.ts");
const SCHEMA_FILE = resolve(ROOT, "src/config/schema.ts");

// ── CLI parsing ──

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: npx tsx scripts/scaffold/scaffold-config.ts <path> [options]

Options:
  --section <sec>      Config section (default: general)
  --type <type>        string|number|boolean|select (default: string)
  --default <val>      Default value (default: "" or 0 or false)
  --desc <text>        Description (default: "TODO")
  --env <key>          Environment variable key (default: auto from path)
  --sensitive          Mark as sensitive (SecretVault encrypted)
  --restart            Requires restart after change
  --options <csv>      Select options: "a,b,c" (only for --type select)
  --dry-run            Preview without writing files`);
  process.exit(0);
}

const field_path = args[0]!;
if (!/^[a-zA-Z][a-zA-Z0-9.]*$/.test(field_path)) {
  console.error(`Error: path must be dot-notation camelCase (got "${field_path}")`);
  process.exit(1);
}

function get_opt(flag: string, fallback: string): string {
  const idx = args.indexOf(`--${flag}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
}

const section = get_opt("section", "general");
const field_type = get_opt("type", "string") as "string" | "number" | "boolean" | "select";
const desc = get_opt("desc", "TODO");
const env_key_raw = get_opt("env", "");
const options_raw = get_opt("options", "");
const sensitive = args.includes("--sensitive");
const restart = args.includes("--restart");
const DRY_RUN = args.includes("--dry-run");

// ── Derived values ──

const default_raw = get_opt("default", "");
function parse_default(): unknown {
  if (default_raw === "") {
    switch (field_type) {
      case "number": return 0;
      case "boolean": return false;
      default: return "";
    }
  }
  if (field_type === "number") return Number(default_raw);
  if (field_type === "boolean") return default_raw === "true";
  return default_raw;
}

const default_value = parse_default();

// Auto-generate env key: "channel.streaming.intervalMs" → "CHANNEL_STREAMING_INTERVAL_MS"
function auto_env_key(path: string): string {
  return path
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/\./g, "_")
    .toUpperCase();
}

const env_key = env_key_raw || auto_env_key(field_path);

// Label: "channel.streaming.intervalMs" → "Interval Ms"
function auto_label(path: string): string {
  const last = path.split(".").pop() || path;
  return last
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

const label = auto_label(field_path);

const select_options = options_raw ? options_raw.split(",").map((s) => s.trim()) : undefined;

// ── Build ConfigFieldMeta entry ──

function build_meta_line(): string {
  const parts: string[] = [
    `path: "${field_path}"`,
    `label: "${label}"`,
    `section: "${section}"`,
    `type: "${field_type}"`,
    `env_key: "${env_key}"`,
    `default_value: ${JSON.stringify(default_value)}`,
    `sensitive: ${sensitive}`,
    `restart_required: ${restart}`,
  ];
  if (select_options) {
    parts.push(`options: [${select_options.map((o) => `"${o}"`).join(", ")}]`);
  }
  parts.push(`description: "${desc}"`);
  return `  { ${parts.join(", ")} },`;
}

// ── Patch config-meta.ts ──

function patch_meta(src: string): string {
  const meta_line = build_meta_line();

  // 해당 section 주석 찾기, 없으면 배열 끝 앞에 삽입
  const section_comment = `// ── ${section}`;
  const section_comment_re = new RegExp(`// ── [^─]+ ──`);

  // 같은 section의 마지막 필드 뒤에 삽입
  // 전략: 해당 section을 가진 마지막 필드 뒤에 삽입
  const field_re = new RegExp(`section: "${section}"`, "g");
  let last_match: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = field_re.exec(src)) !== null) last_match = m;

  if (last_match) {
    // 해당 줄의 끝 찾기
    const line_end = src.indexOf("\n", last_match.index);
    return src.slice(0, line_end + 1) + meta_line + "\n" + src.slice(line_end + 1);
  }

  // section이 없으면 CONFIG_FIELDS 배열 마지막 "];" 앞에 삽입
  const closing = src.lastIndexOf("];");
  const section_header = `\n  // ── ${section} ──\n`;
  return src.slice(0, closing) + section_header + meta_line + "\n" + src.slice(closing);
}

// ── Execute ──

const meta_src = readFileSync(META_FILE, "utf-8");
if (meta_src.includes(`path: "${field_path}"`)) {
  console.error(`Error: field "${field_path}" already exists in config-meta.ts`);
  process.exit(1);
}

const patched_meta = patch_meta(meta_src);

if (DRY_RUN) {
  console.log("[dry-run] Would patch: config/config-meta.ts");
  console.log(`[dry-run] Field: ${field_path}`);
  console.log(`[dry-run] Section: ${section}`);
  console.log(`[dry-run] Type: ${field_type}`);
  console.log(`[dry-run] Default: ${JSON.stringify(default_value)}`);
  console.log(`[dry-run] Env: ${env_key}`);
  console.log(`[dry-run] Sensitive: ${sensitive}`);
  console.log(`[dry-run] Restart: ${restart}`);
  if (select_options) console.log(`[dry-run] Options: ${select_options.join(", ")}`);
  console.log("\n--- Meta entry ---");
  console.log(build_meta_line());
} else {
  writeFileSync(META_FILE, patched_meta, "utf-8");
  console.log(`Patched: config/config-meta.ts (+${field_path})`);
  console.log(`  section: ${section}, type: ${field_type}, env: ${env_key}`);
}
