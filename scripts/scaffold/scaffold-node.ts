#!/usr/bin/env tsx
/**
 * 워크플로우 노드 스캐폴드 생성기.
 *
 * Usage:
 *   npx tsx scripts/scaffold/scaffold-node.ts <node_type> [options]
 *   npx tsx scripts/scaffold/scaffold-node.ts my_widget --category data --icon 📦 --color "#e67e22" --outputs "result:string,count:number"
 *   npx tsx scripts/scaffold/scaffold-node.ts my_widget --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NODES_DIR = resolve(ROOT, "web/src/pages/workflows/nodes");
const INDEX_FILE = resolve(NODES_DIR, "index.ts");
const BACKEND_NODES_DIR = resolve(ROOT, "src/agent/nodes");
const BACKEND_INDEX_FILE = resolve(BACKEND_NODES_DIR, "index.ts");
const NODE_TYPES_FILE = resolve(ROOT, "src/agent/workflow-node.types.ts");
const EN_JSON = resolve(ROOT, "src/i18n/locales/en.json");
const KO_JSON = resolve(ROOT, "src/i18n/locales/ko.json");

// ── CLI parsing ──

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: npx tsx scripts/scaffold/scaffold-node.ts <node_type> [options]

Options:
  --category <cat>   flow|data|ai|integration|interaction|advanced (default: advanced)
  --icon <emoji>     Unicode icon (default: 🔧)
  --color <hex>      Hex color (default: #95a5a6)
  --shape <shape>    rect|diamond (default: rect)
  --outputs <spec>   Output schema: name:type,... (default: result:string)
  --inputs <spec>    Input schema: name:type,...
  --backend          Also generate backend node handler (src/agent/nodes/)
  --dry-run          Preview without writing files`);
  process.exit(0);
}

const node_type = args[0]!;
if (!/^[a-z][a-z0-9_]*$/.test(node_type)) {
  console.error(`Error: node_type must be lowercase snake_case (got "${node_type}")`);
  process.exit(1);
}

function get_opt(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
}

const category = get_opt("category", "advanced");
const icon = get_opt("icon", "🔧");
const color = get_opt("color", "#95a5a6");
const shape = get_opt("shape", "rect");
const outputs_raw = get_opt("outputs", "result:string");
const inputs_raw = get_opt("inputs", "");
const WITH_BACKEND = args.includes("--backend");
const DRY_RUN = args.includes("--dry-run");

type SchemaField = { name: string; type: string };

function parse_fields(spec: string): SchemaField[] {
  if (!spec.trim()) return [];
  return spec.split(",").map((s) => {
    const [name, type] = s.trim().split(":");
    return { name: name!, type: type || "string" };
  });
}

const outputs = parse_fields(outputs_raw);
const inputs = parse_fields(inputs_raw);

// ── File name helpers ──

const file_name = node_type.replace(/_/g, "-"); // snake_case → kebab-case
const tsx_path = resolve(NODES_DIR, `${file_name}.tsx`);
const backend_ts_path = resolve(BACKEND_NODES_DIR, `${file_name}.ts`);
const descriptor_name = `${node_type}_descriptor`;
const handler_name = `${node_type}_handler`;
const pascal = node_type
  .split("_")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join("");
const panel_name = `${pascal}EditPanel`;
const human_label = node_type
  .split("_")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

// ── 1. Generate .tsx ──

function gen_schema_lines(fields: SchemaField[], direction: "input" | "output"): string {
  return fields
    .map((f) => `    { name: "${f.name}", type: "${f.type}", description: "node.${node_type}.${direction}.${f.name}" },`)
    .join("\n");
}

const tsx_content = `import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function ${panel_name}({ node, update, t }: EditPanelProps) {
  return (
    <>
${inputs.map((f) => `      <div className="builder-row">
        <label className="label">{t("node.${node_type}.input.${f.name}")}</label>
        <input className="input input--sm" value={String(node.${f.name} || "")} onChange={(e) => update({ ${f.name}: e.target.value })} />
      </div>`).join("\n")}
    </>
  );
}

export const ${descriptor_name}: FrontendNodeDescriptor = {
  node_type: "${node_type}",
  icon: "${icon}",
  color: "${color}",
  shape: "${shape}",
  toolbar_label: "node.${node_type}.label",
  category: "${category}",
  output_schema: [
${gen_schema_lines(outputs, "output")}
  ],
  input_schema: [
${gen_schema_lines(inputs, "input")}
  ],
  create_default: () => ({${inputs.map((f) => ` ${f.name}: ""`).join(",")} }),
  EditPanel: ${panel_name},
};
`;

// ── 2. Generate backend handler .ts ──

function gen_backend_output_schema(): string {
  return outputs
    .map((f) => `    { name: "${f.name}", type: "${f.type}", description: "${f.name.replace(/_/g, " ")}" },`)
    .join("\n");
}

function gen_backend_input_schema(): string {
  if (inputs.length === 0) return "";
  return inputs
    .map((f) => `    { name: "${f.name}", type: "${f.type}", description: "${f.name.replace(/_/g, " ")}" },`)
    .join("\n");
}

function gen_backend_ts(): string {
  return `/** ${human_label} node handler. */

import type { NodeHandler } from "../node-registry.js";
import type { ${iface_name}, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const ${handler_name}: NodeHandler = {
  node_type: "${node_type}",
  icon: "${icon}",
  color: "${color}",
  shape: "${shape}",
  output_schema: [
${gen_backend_output_schema()}
  ],
  input_schema: [
${gen_backend_input_schema()}
  ],
  create_default: () => ({${inputs.map((f) => ` ${f.name}: ""`).join(",")} }),

  async execute(_node: OrcheNodeDefinition): Promise<OrcheNodeExecuteResult> {
    // TODO: implement
    return { output: {${outputs.map((f) => ` ${f.name}: ""`).join(",")} } };
  },

  test(_node: OrcheNodeDefinition): OrcheNodeTestResult {
    return { preview: {}, warnings: [] };
  },
};
`;
}

// ── 3. Patch workflow-node.types.ts ──

const iface_name = `${pascal}NodeDefinition`;

function ts_type_for(field_type: string): string {
  switch (field_type) {
    case "number": case "integer": return "number";
    case "boolean": return "boolean";
    case "object": return "Record<string, unknown>";
    case "array": return "unknown[]";
    default: return "string";
  }
}

function gen_interface(): string {
  const fields = inputs.map((f) =>
    `  ${f.name}?: ${ts_type_for(f.type)};`,
  );
  return [
    `export interface ${iface_name} extends NodeBase {`,
    `  node_type: "${node_type}";`,
    ...fields,
    `}`,
  ].join("\n");
}

function patch_node_types(src: string): { patched: string; errors: string[] } {
  let patched = src;
  const errors: string[] = [];

  // 1) OrcheNodeType 리터럴에 추가: 마지막 | "end"; 앞에
  const before1 = patched;
  patched = patched.replace(
    /(\| "end";)/,
    `| "${node_type}"\n  $1`,
  );
  if (patched === before1) errors.push('OrcheNodeType anchor not found: \'| "end";\' pattern missing');

  // 2) OrcheNodeDefinition union에 추가: | EndNodeDefinition; 앞에
  const before2 = patched;
  patched = patched.replace(
    /(\| EndNodeDefinition;)/,
    `| ${iface_name}\n  $1`,
  );
  if (patched === before2) errors.push("OrcheNodeDefinition anchor not found: '| EndNodeDefinition;' pattern missing");

  // 3) 인터페이스 삽입: "// ── Union Types" 마커 앞에
  const marker = "// ── Union Types";
  const marker_idx = patched.indexOf(marker);
  if (marker_idx < 0) {
    errors.push("interface marker not found: '// ── Union Types' missing");
  } else {
    const iface_block = gen_interface() + "\n\n";
    patched = patched.slice(0, marker_idx) + iface_block + patched.slice(marker_idx);
  }

  return { patched, errors };
}

// ── 4. Patch backend nodes/index.ts ──

function patch_backend_index(src: string): { patched: string; errors: string[] } {
  const import_line = `import { ${handler_name} } from "./${file_name}.js";`;
  const errors: string[] = [];

  // import 삽입: 마지막 import 뒤
  const last_import_idx = src.lastIndexOf("\nimport ");
  if (last_import_idx < 0) {
    errors.push("backend index: no import lines found");
    return { patched: src, errors };
  }
  const end_of_last_import = src.indexOf("\n", last_import_idx + 1);
  let patched = src.slice(0, end_of_last_import + 1) + import_line + "\n" + src.slice(end_of_last_import + 1);

  // ALL_HANDLERS 배열 마지막 항목 뒤
  const handlers_idx = patched.indexOf("const ALL_HANDLERS");
  if (handlers_idx < 0) {
    errors.push("backend index: 'const ALL_HANDLERS' not found");
    return { patched, errors };
  }
  const closing_bracket = patched.indexOf("];", handlers_idx);
  if (closing_bracket < 0) {
    errors.push("backend index: closing ']' for ALL_HANDLERS not found");
    return { patched, errors };
  }
  patched = patched.slice(0, closing_bracket) + `  ${handler_name},\n` + patched.slice(closing_bracket);

  return { patched, errors };
}

// ── 4. Patch frontend nodes/index.ts ──

function patch_index(src: string): { patched: string; errors: string[] } {
  const import_line = `import { ${descriptor_name} } from "./${file_name}";`;
  const array_entry = `  ${descriptor_name},`;
  const errors: string[] = [];

  // import 삽입: 마지막 import 뒤
  const last_import_idx = src.lastIndexOf("\nimport ");
  if (last_import_idx < 0) {
    errors.push("frontend index: no import lines found");
    return { patched: src, errors };
  }
  const end_of_last_import = src.indexOf("\n", last_import_idx + 1);
  let patched = src.slice(0, end_of_last_import + 1) + import_line + "\n" + src.slice(end_of_last_import + 1);

  // ALL_DESCRIPTORS 배열 마지막 항목 뒤
  const descriptors_idx = patched.indexOf("const ALL_DESCRIPTORS");
  if (descriptors_idx < 0) {
    errors.push("frontend index: 'const ALL_DESCRIPTORS' not found");
    return { patched, errors };
  }
  const closing_bracket = patched.indexOf("];", descriptors_idx);
  if (closing_bracket < 0) {
    errors.push("frontend index: closing ']' for ALL_DESCRIPTORS not found");
    return { patched, errors };
  }
  patched = patched.slice(0, closing_bracket) + array_entry + "\n" + patched.slice(closing_bracket);

  return { patched, errors };
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
  keys[`node.${node_type}.label`] = lang === "en" ? human_label : human_label;
  for (const f of outputs) {
    const desc = f.name.replace(/_/g, " ");
    keys[`node.${node_type}.output.${f.name}`] = lang === "en" ? desc.charAt(0).toUpperCase() + desc.slice(1) : desc;
  }
  for (const f of inputs) {
    const desc = f.name.replace(/_/g, " ");
    keys[`node.${node_type}.input.${f.name}`] = lang === "en" ? desc.charAt(0).toUpperCase() + desc.slice(1) : desc;
  }
  return keys;
}

// ── Execute ──

if (existsSync(tsx_path)) {
  console.error(`Error: ${tsx_path} already exists`);
  process.exit(1);
}

const index_src = readFileSync(INDEX_FILE, "utf-8");
if (index_src.includes(descriptor_name)) {
  console.error(`Error: ${descriptor_name} already registered in frontend index.ts`);
  process.exit(1);
}

if (WITH_BACKEND) {
  if (existsSync(backend_ts_path)) {
    console.error(`Error: ${backend_ts_path} already exists`);
    process.exit(1);
  }
  const backend_index_src = readFileSync(BACKEND_INDEX_FILE, "utf-8");
  if (backend_index_src.includes(handler_name)) {
    console.error(`Error: ${handler_name} already registered in backend index.ts`);
    process.exit(1);
  }
  const node_types_src = readFileSync(NODE_TYPES_FILE, "utf-8");
  if (node_types_src.includes(`interface ${iface_name}`)) {
    console.error(`Error: ${iface_name} already exists in workflow-node.types.ts`);
    process.exit(1);
  }
}

// 모든 패치를 사전 계산 — 앵커 실패 시 쓰기 전에 중단
const all_errors: string[] = [];

const { patched: patched_index, errors: fe_index_errors } = patch_index(index_src);
all_errors.push(...fe_index_errors);

const patched_en = patch_json(EN_JSON, build_i18n_keys("en"));
const patched_ko = patch_json(KO_JSON, build_i18n_keys("ko"));

let patched_backend_index = "";
let patched_node_types = "";
if (WITH_BACKEND) {
  const backend_index_src = readFileSync(BACKEND_INDEX_FILE, "utf-8");
  const be_result = patch_backend_index(backend_index_src);
  all_errors.push(...be_result.errors);
  patched_backend_index = be_result.patched;

  const node_types_src = readFileSync(NODE_TYPES_FILE, "utf-8");
  const nt_result = patch_node_types(node_types_src);
  all_errors.push(...nt_result.errors);
  patched_node_types = nt_result.patched;
}

if (all_errors.length > 0) {
  console.error("Error: patch anchors not found — no files written:");
  for (const e of all_errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log("[dry-run] Would create:", tsx_path);
  console.log("[dry-run] Would patch: frontend nodes/index.ts");
  if (WITH_BACKEND) {
    console.log("[dry-run] Would create:", backend_ts_path);
    console.log("[dry-run] Would patch: backend nodes/index.ts");
    console.log("[dry-run] Would patch: workflow-node.types.ts (+interface, +OrcheNodeType, +union)");
  }
  console.log("[dry-run] i18n keys (en):", Object.keys(build_i18n_keys("en")).join(", "));
  console.log("[dry-run] i18n keys (ko):", Object.keys(build_i18n_keys("ko")).join(", "));
  console.log("\n--- Generated .tsx (frontend) ---\n" + tsx_content);
  if (WITH_BACKEND) {
    console.log("\n--- Generated .ts (backend) ---\n" + gen_backend_ts());
  }
} else {
  // all-or-nothing: 모든 패치 계산 완료 후 일괄 쓰기
  const writes: Array<[string, string]> = [
    [tsx_path, tsx_content],
    [INDEX_FILE, patched_index],
    [EN_JSON, patched_en],
    [KO_JSON, patched_ko],
  ];
  if (WITH_BACKEND) {
    writes.push(
      [backend_ts_path, gen_backend_ts()],
      [BACKEND_INDEX_FILE, patched_backend_index],
      [NODE_TYPES_FILE, patched_node_types],
    );
  }
  for (const [path, content] of writes) writeFileSync(path, content, "utf-8");

  console.log(`Created: web/src/pages/workflows/nodes/${file_name}.tsx`);
  console.log(`Patched: frontend nodes/index.ts (+import, +descriptor)`);
  if (WITH_BACKEND) {
    console.log(`Created: src/agent/nodes/${file_name}.ts`);
    console.log(`Patched: backend nodes/index.ts (+import, +handler)`);
    console.log(`Patched: workflow-node.types.ts (+${iface_name}, +OrcheNodeType, +union)`);
  }
  console.log(`Patched: en.json, ko.json (+${Object.keys(build_i18n_keys("en")).length} keys each)`);
}
