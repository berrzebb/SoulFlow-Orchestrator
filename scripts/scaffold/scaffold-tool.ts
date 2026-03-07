#!/usr/bin/env tsx
/**
 * 백엔드 도구 스캐폴드 생성기.
 *
 * Usage:
 *   npx tsx scripts/scaffold/scaffold-tool.ts <tool_name> [options]
 *   npx tsx scripts/scaffold/scaffold-tool.ts my_tool --category memory --params "operation:string,input:string" --desc "My tool description"
 *   npx tsx scripts/scaffold/scaffold-tool.ts my_tool --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TOOLS_DIR = resolve(ROOT, "src/agent/tools");
const INDEX_FILE = resolve(TOOLS_DIR, "index.ts");
const EN_JSON = resolve(ROOT, "src/i18n/locales/en.json");
const KO_JSON = resolve(ROOT, "src/i18n/locales/ko.json");

// ── CLI parsing ──

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: npx tsx scripts/scaffold/scaffold-tool.ts <tool_name> [options]

Options:
  --category <cat>   ToolCategory (default: external)
  --params <spec>    Parameters: name:type,... (type: string|number|integer|boolean)
  --desc <text>      Tool description (default: TODO)
  --write            Set policy_flags.write = true
  --network          Set policy_flags.network = true
  --dry-run          Preview without writing files`);
  process.exit(0);
}

const tool_name = args[0]!;
if (!/^[a-z][a-z0-9_]*$/.test(tool_name)) {
  console.error(`Error: tool_name must be lowercase snake_case (got "${tool_name}")`);
  process.exit(1);
}

function get_opt(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
}

const category = get_opt("category", "external");
const params_raw = get_opt("params", "");
const desc = get_opt("desc", "TODO");
const flag_write = args.includes("--write");
const flag_network = args.includes("--network");
const DRY_RUN = args.includes("--dry-run");

type Param = { name: string; type: string };

function parse_params(spec: string): Param[] {
  if (!spec.trim()) return [];
  return spec.split(",").map((s) => {
    const [name, type] = s.trim().split(":");
    return { name: name!, type: type || "string" };
  });
}

const params = parse_params(params_raw);

// ── Name helpers ──

const file_name = tool_name.replace(/_/g, "-");
const ts_path = resolve(TOOLS_DIR, `${file_name}.ts`);
const pascal = tool_name
  .split("_")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join("");
const class_name = `${pascal}Tool`;

// ── 1. Generate .ts ──

function gen_properties(): string {
  if (params.length === 0) return "";
  const lines = params.map((p) => {
    const human = p.name.replace(/_/g, " ");
    return `      ${p.name}: { type: "${p.type}", description: "${human}" },`;
  });
  return lines.join("\n");
}

function gen_policy_flags(): string {
  if (!flag_write && !flag_network) return "";
  const parts: string[] = [];
  if (flag_write) parts.push("write: true");
  if (flag_network) parts.push("network: true");
  return `\n  readonly policy_flags = { ${parts.join(", ")} } as const;\n`;
}

const required_list = params.length > 0
  ? `    required: [${params.map((p) => `"${p.name}"`).join(", ")}],`
  : "    required: [],";

const ts_content = `import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class ${class_name} extends Tool {
  readonly name = "${tool_name}";
  readonly category = "${category}" as const;
  readonly description = "${desc}";
${gen_policy_flags()}
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
${gen_properties()}
    },
${required_list}
    additionalProperties: false,
  };

  protected async run(
    params: Record<string, unknown>,
    _context?: ToolExecutionContext,
  ): Promise<string> {
${params.length > 0 ? params.map((p) => `    const ${p.name} = ${p.type === "string" ? `String(params.${p.name} || "")` : `Number(params.${p.name} || 0)`};`).join("\n") : "    // TODO: implement"}

    return JSON.stringify({ status: "ok" });
  }
}
`;

// ── 2. Patch index.ts ──

function patch_index(src: string): string {
  let patched = src;

  // import 삽입: 마지막 tool import 뒤
  const import_line = `import { ${class_name} } from "./${file_name}.js";`;
  const last_import_re = /^import .* from "\.\/[^"]+\.js";$/gm;
  let last_match: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = last_import_re.exec(patched)) !== null) last_match = m;
  if (last_match) {
    const pos = last_match.index + last_match[0].length;
    patched = patched.slice(0, pos) + "\n" + import_line + patched.slice(pos);
  }

  // export 블록에 추가: "MarkdownTool," 뒤
  patched = patched.replace(
    /(  MarkdownTool,\n)(};)/,
    `$1  ${class_name},\n$2`,
  );

  // registry.register 추가: "new MarkdownTool()" 뒤
  patched = patched.replace(
    /(registry\.register\(new MarkdownTool\(\)\);)/,
    `$1\n  registry.register(new ${class_name}());`,
  );

  return patched;
}

// ── 3. Patch i18n JSON ──

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
  keys[`tool.${tool_name}.desc`] = lang === "en" ? desc : desc;
  for (const p of params) {
    const human = p.name.replace(/_/g, " ");
    keys[`tool.${tool_name}.param.${p.name}`] = lang === "en" ? human.charAt(0).toUpperCase() + human.slice(1) : human;
  }
  return keys;
}

// ── Execute ──

if (existsSync(ts_path)) {
  console.error(`Error: ${ts_path} already exists`);
  process.exit(1);
}

const index_src = readFileSync(INDEX_FILE, "utf-8");
if (index_src.includes(class_name)) {
  console.error(`Error: ${class_name} already registered in index.ts`);
  process.exit(1);
}

const patched_index = patch_index(index_src);
const patched_en = patch_json(EN_JSON, build_i18n_keys("en"));
const patched_ko = patch_json(KO_JSON, build_i18n_keys("ko"));

if (DRY_RUN) {
  console.log("[dry-run] Would create:", ts_path);
  console.log("[dry-run] Would patch: tools/index.ts");
  console.log("[dry-run] i18n keys (en):", Object.keys(build_i18n_keys("en")).join(", "));
  console.log("[dry-run] i18n keys (ko):", Object.keys(build_i18n_keys("ko")).join(", "));
  console.log("\n--- Generated .ts ---\n" + ts_content);
} else {
  writeFileSync(ts_path, ts_content, "utf-8");
  writeFileSync(INDEX_FILE, patched_index, "utf-8");
  writeFileSync(EN_JSON, patched_en, "utf-8");
  writeFileSync(KO_JSON, patched_ko, "utf-8");
  console.log(`Created: src/agent/tools/${file_name}.ts`);
  console.log(`Patched: tools/index.ts (+import, +export, +register)`);
  console.log(`Patched: en.json, ko.json (+${Object.keys(build_i18n_keys("en")).length} keys each)`);
}
