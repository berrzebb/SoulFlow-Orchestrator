#!/usr/bin/env tsx
/**
 * 커맨드 핸들러 스캐폴드 생성기.
 *
 * Usage:
 *   npx tsx scripts/scaffold/scaffold-handler.ts <name> [options]
 *   npx tsx scripts/scaffold/scaffold-handler.ts foo --aliases "푸,bar" --subcommands "status,list,set <key> <value>"
 *   npx tsx scripts/scaffold/scaffold-handler.ts foo --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CMD_DIR = resolve(ROOT, "src/channels/commands");
const INDEX_FILE = resolve(CMD_DIR, "index.ts");
const REGISTRY_FILE = resolve(CMD_DIR, "registry.ts");
const EN_JSON = resolve(ROOT, "src/i18n/locales/en.json");
const KO_JSON = resolve(ROOT, "src/i18n/locales/ko.json");

// ── CLI parsing ──

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: npx tsx scripts/scaffold/scaffold-handler.ts <name> [options]

Options:
  --aliases <csv>       Korean/English aliases (default: none)
  --subcommands <spec>  Subcommands: "status,list,set <key> <value>"
  --access <iface>      Access interface name (default: auto-generated)
  --dry-run             Preview without writing files`);
  process.exit(0);
}

const name = args[0]!;
if (!/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error(`Error: name must be lowercase snake_case (got "${name}")`);
  process.exit(1);
}

function get_opt(flag: string, fallback: string): string {
  const idx = args.indexOf(`--${flag}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
}

const aliases_raw = get_opt("aliases", "");
const subcmds_raw = get_opt("subcommands", "");
const access_name = get_opt("access", "");
const DRY_RUN = args.includes("--dry-run");

// ── Parse subcommands ──

type SubcmdSpec = { name: string; usage?: string };

function parse_subcmds(spec: string): SubcmdSpec[] {
  if (!spec.trim()) return [];
  return spec.split(",").map((s) => {
    const trimmed = s.trim();
    const space_idx = trimmed.indexOf(" ");
    if (space_idx < 0) return { name: trimmed };
    return { name: trimmed.slice(0, space_idx), usage: trimmed.slice(space_idx + 1) };
  });
}

const subcmds = parse_subcmds(subcmds_raw);
const aliases = aliases_raw ? aliases_raw.split(",").map((s) => s.trim()).filter(Boolean) : [];

// ── Name helpers ──

const file_base = name.replace(/_/g, "-");
const handler_path = resolve(CMD_DIR, `${file_base}.handler.ts`);
const pascal = name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const handler_class = `${pascal}Handler`;
const iface_name = access_name || `${pascal}Access`;

// ── 1. Generate handler .ts ──

function gen_handler(): string {
  const all_aliases = [name, ...aliases];
  const aliases_literal = all_aliases.map((a) => `"${a}"`).join(", ");
  const needs_access = subcmds.length > 0;

  const imports = [
    `import { slash_name_in } from "../slash-command.js";`,
    `import { format_subcommand_guide } from "./registry.js";`,
    `import { format_mention, type CommandContext, type CommandHandler } from "./types.js";`,
  ];

  const lines: string[] = [...imports, ""];

  lines.push(`const ALIASES = [${aliases_literal}] as const;`);
  lines.push("");

  if (needs_access) {
    lines.push(`export interface ${iface_name} {`);
    lines.push(`  // TODO: define access methods`);
    lines.push(`}`);
    lines.push("");
  }

  lines.push(`export class ${handler_class} implements CommandHandler {`);
  lines.push(`  readonly name = "${name}";`);
  lines.push("");

  if (needs_access) {
    lines.push(`  constructor(private readonly access: ${iface_name}) {}`);
  }

  lines.push("");
  lines.push(`  can_handle(ctx: CommandContext): boolean {`);
  lines.push(`    return slash_name_in(ctx.command?.name || "", ALIASES);`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  async handle(ctx: CommandContext): Promise<boolean> {`);
  lines.push(`    const mention = format_mention(ctx.provider, ctx.message.sender_id);`);

  if (subcmds.length > 0) {
    lines.push(`    const args = ctx.command?.args || [];`);
    lines.push(`    const action = (args[0] || "").toLowerCase();`);
    lines.push("");
    lines.push(`    if (!action) {`);
    lines.push(`      const guide = format_subcommand_guide("${name}");`);
    lines.push(`      if (guide) { await ctx.send_reply(\`\${mention}\${guide}\`); return true; }`);
    lines.push(`    }`);
    lines.push("");
    lines.push(`    // TODO: implement subcommand handlers`);
    lines.push(`    await ctx.send_reply(\`\${mention}TODO: /${name} \${action}\`);`);
  } else {
    lines.push("");
    lines.push(`    // TODO: implement`);
    lines.push(`    await ctx.send_reply(\`\${mention}TODO: /${name}\`);`);
  }

  lines.push(`    return true;`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

// ── 2. Patch index.ts ──

function patch_index(src: string): string {
  const export_parts = [`${handler_class}`];
  if (subcmds.length > 0) export_parts.push(`type ${iface_name}`);

  const export_line = `export { ${export_parts.join(", ")} } from "./${file_base}.handler.js";`;

  // 마지막 export 줄 뒤에 삽입
  const last_export_re = /^export .* from "\.\/[^"]+\.handler\.js";$/gm;
  let last_match: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = last_export_re.exec(src)) !== null) last_match = m;
  if (!last_match) {
    return src + "\n" + export_line + "\n";
  }
  const pos = last_match.index + last_match[0].length;
  return src.slice(0, pos) + "\n" + export_line + src.slice(pos);
}

// ── 3. Patch registry.ts ──

function patch_registry(src: string): string {
  // DESCRIPTORS 배열의 마지막 cmd() 호출 뒤에 삽입
  let new_entry: string;
  if (subcmds.length === 0) {
    new_entry = `  cmd("${name}"),`;
  } else {
    const sub_lines = subcmds.map((s) => {
      const usage_part = s.usage ? `, usage: "${s.usage}"` : "";
      return `      { name: "${s.name}"${usage_part} },`;
    });
    new_entry = [
      `  cmd("${name}", {`,
      `    subcommands: [`,
      ...sub_lines,
      `    ],`,
      `  }),`,
    ].join("\n");
  }

  // "] as const;" 바로 앞에 삽입
  const marker = "] as const;";
  const idx = src.indexOf(marker);
  if (idx < 0) {
    console.error("Error: could not find DESCRIPTORS array end marker in registry.ts");
    process.exit(1);
  }
  return src.slice(0, idx) + new_entry + "\n" + src.slice(idx);
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
  const human = name.replace(/_/g, " ");
  keys[`cmd.${name}.desc`] = lang === "en"
    ? human.charAt(0).toUpperCase() + human.slice(1)
    : `TODO_${name}`;
  for (const s of subcmds) {
    const sub_human = s.name.replace(/_/g, " ");
    keys[`cmd.${name}.sub.${s.name}.desc`] = lang === "en"
      ? sub_human.charAt(0).toUpperCase() + sub_human.slice(1)
      : `TODO_${s.name}`;
  }
  return keys;
}

// ── Execute ──

if (existsSync(handler_path)) {
  console.error(`Error: ${handler_path} already exists`);
  process.exit(1);
}

const index_src = readFileSync(INDEX_FILE, "utf-8");
if (index_src.includes(handler_class)) {
  console.error(`Error: ${handler_class} already registered in index.ts`);
  process.exit(1);
}

const registry_src = readFileSync(REGISTRY_FILE, "utf-8");
if (registry_src.includes(`cmd("${name}"`)) {
  console.error(`Error: cmd("${name}") already exists in registry.ts`);
  process.exit(1);
}

const handler_content = gen_handler();
const patched_index = patch_index(index_src);
const patched_registry = patch_registry(registry_src);
const patched_en = patch_json(EN_JSON, build_i18n_keys("en"));
const patched_ko = patch_json(KO_JSON, build_i18n_keys("ko"));

if (DRY_RUN) {
  const en_keys = build_i18n_keys("en");
  const ko_keys = build_i18n_keys("ko");
  console.log("[dry-run] Would create:", handler_path);
  console.log("[dry-run] Would patch: commands/index.ts");
  console.log("[dry-run] Would patch: commands/registry.ts");
  console.log(`[dry-run] i18n keys (en): ${Object.keys(en_keys).join(", ")}`);
  console.log(`[dry-run] i18n keys (ko): ${Object.keys(ko_keys).join(", ")}`);
  console.log("\n--- Generated handler ---\n" + handler_content);
  console.log("\n--- Registry entry ---");
  // 새 entry만 표시
  const marker = "] as const;";
  const idx = registry_src.indexOf(marker);
  const diff = patched_registry.slice(idx, patched_registry.indexOf(marker));
  console.log(diff.trim());
} else {
  writeFileSync(handler_path, handler_content, "utf-8");
  writeFileSync(INDEX_FILE, patched_index, "utf-8");
  writeFileSync(REGISTRY_FILE, patched_registry, "utf-8");
  writeFileSync(EN_JSON, patched_en, "utf-8");
  writeFileSync(KO_JSON, patched_ko, "utf-8");
  console.log(`Created: src/channels/commands/${file_base}.handler.ts`);
  console.log(`Patched: commands/index.ts (+export)`);
  console.log(`Patched: commands/registry.ts (+cmd entry)`);
  console.log(`Patched: en.json, ko.json (+${Object.keys(build_i18n_keys("en")).length} keys each)`);
}
