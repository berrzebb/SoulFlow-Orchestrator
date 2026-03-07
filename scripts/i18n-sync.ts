#!/usr/bin/env tsx
/**
 * i18n 동기화 자동화 도구.
 *
 * 소스 코드를 스캔하여 i18n 키 사용 현황을 분석하고,
 * en.json / ko.json과 대조하여 누락/고아/미번역 키를 보고.
 *
 * Usage:
 *   npx tsx scripts/i18n-sync.ts           # 보고 모드
 *   npx tsx scripts/i18n-sync.ts --fix     # 누락 키에 스텁 자동 추가
 *   npx tsx scripts/i18n-sync.ts --check   # CI 모드: 누락 시 exit 1
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, extname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOCALES_DIR = resolve(ROOT, "src/i18n/locales");

// ── CLI 인수 ──

const args = process.argv.slice(2);
const MODE = args.includes("--fix") ? "fix" : args.includes("--check") ? "check" : "report";

// ── JSON 로드 ──

type Dict = Record<string, string>;

function load_json(path: string): Dict {
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return {}; }
}

function save_json(path: string, dict: Dict): void {
  const sorted: Dict = {};
  for (const key of Object.keys(dict).sort()) sorted[key] = dict[key];
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

// ── 파일 수집 ──

function walk(dir: string, exts: Set<string>, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full, exts, out); continue; }
    if (exts.has(extname(full))) out.push(full);
  }
  return out;
}

// ── 1. t("key") 호출 스캔 ──

const T_CALL_RE = /\bt\(\s*["'`]([^"'`]+)["'`]/g;

function scan_t_calls(files: string[]): Set<string> {
  const keys = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(T_CALL_RE)) {
      keys.add(m[1]);
    }
  }
  return keys;
}

// ── 2. 백엔드 도구 스캔 ──

type ToolMeta = { name: string; desc: string; params: string[] };

function scan_backend_tools(): { tool_names: string[]; expected_keys: Set<string>; tool_meta: ToolMeta[] } {
  const tools_dir = resolve(ROOT, "src/agent/tools");
  const files = walk(tools_dir, new Set([".ts"]));
  const tool_names: string[] = [];
  const expected = new Set<string>();
  const tool_meta: ToolMeta[] = [];

  const NAME_RE = /readonly\s+name\s*=\s*["']([^"']+)["']/;
  // description: 한 줄 또는 여러 줄 문자열 모두 지원
  const DESC_RE = /readonly\s+description\s*=\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([\s\S]*?);)/;

  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    const name_match = src.match(NAME_RE);
    if (!name_match) continue;
    const tool_name = name_match[1];
    tool_names.push(tool_name);
    expected.add(`tool.${tool_name}.desc`);

    // description 추출
    const desc_match = src.match(DESC_RE);
    const desc = (desc_match?.[1] || desc_match?.[2] || desc_match?.[3] || "").trim().replace(/\s+/g, " ");

    // parameters 블록에서 param 이름 추출
    const params: string[] = [];
    const params_block = src.match(/readonly\s+parameters\s*[=:]\s*\{[\s\S]*?(?:^\s*\};|\n\s*\})/m);
    if (params_block) {
      const props_match = params_block[0].match(/properties\s*:\s*\{([\s\S]*?)\n\s*\}/);
      if (props_match) {
        for (const pm of props_match[1].matchAll(/(\w+)\s*:\s*\{/g)) {
          expected.add(`tool.${tool_name}.param.${pm[1]}`);
          params.push(pm[1]);
        }
      }
    }
    tool_meta.push({ name: tool_name, desc, params });
  }
  return { tool_names, expected_keys: expected, tool_meta };
}

// ── 3. 프론트엔드 노드 스캔 ──

type NodeMeta = { type: string; label: string; fields: Map<string, string> };

function scan_frontend_nodes(): { node_types: string[]; expected_keys: Set<string>; node_meta: NodeMeta[] } {
  const nodes_dir = resolve(ROOT, "web/src/pages/workflows/nodes");
  const files = walk(nodes_dir, new Set([".tsx"]));
  const node_types: string[] = [];
  const expected = new Set<string>();
  const node_meta: NodeMeta[] = [];

  const TYPE_RE = /node_type\s*:\s*["']([^"']+)["']/;
  const LABEL_RE = /toolbar_label\s*:\s*["']([^"']+)["']/;
  const FIELD_RE = /\{\s*name\s*:\s*["']([^"']+)["']\s*,\s*type\s*:\s*["'][^"']+["']\s*,\s*description\s*:\s*["']([^"']+)["']/g;

  for (const file of files) {
    if (basename(file) === "index.ts") continue;
    const src = readFileSync(file, "utf-8");
    const type_match = src.match(TYPE_RE);
    if (!type_match) continue;
    const node_type = type_match[1];
    node_types.push(node_type);
    expected.add(`node.${node_type}.label`);

    const label_match = src.match(LABEL_RE);
    const label = (label_match?.[1] || "").replace(/^\+\s*/, "").trim();
    const fields = new Map<string, string>();

    // output_schema에서 필드명 + description 추출
    const output_block = src.match(/output_schema\s*:\s*\[([\s\S]*?)\]/);
    if (output_block) {
      for (const om of output_block[1].matchAll(FIELD_RE)) {
        const key = `node.${node_type}.output.${om[1]}`;
        expected.add(key);
        fields.set(key, om[2]);
      }
    }

    // input_schema에서 필드명 + description 추출
    const input_block = src.match(/input_schema\s*:\s*\[([\s\S]*?)\]/);
    if (input_block) {
      for (const im of input_block[1].matchAll(FIELD_RE)) {
        const key = `node.${node_type}.input.${im[1]}`;
        expected.add(key);
        fields.set(key, im[2]);
      }
    }

    node_meta.push({ type: node_type, label, fields });
  }

  // 카테고리 라벨
  for (const cat of ["flow", "data", "ai", "integration", "interaction", "advanced"]) {
    expected.add(`cat.${cat}`);
  }

  return { node_types, expected_keys: expected, node_meta };
}

// ── 메인 ──

function main() {
  console.log(`[i18n-sync] Mode: ${MODE}`);
  console.log(`[i18n-sync] Locales dir: ${relative(ROOT, LOCALES_DIR)}`);
  console.log();

  // 1. 소스 스캔
  console.log("[i18n-sync] Scanning sources...");
  const fe_files = walk(resolve(ROOT, "web/src"), new Set([".ts", ".tsx"]));
  const be_files = walk(resolve(ROOT, "src"), new Set([".ts"]));
  const all_files = [...fe_files, ...be_files];

  const t_keys_raw = scan_t_calls(all_files);
  // 동적 키 제거 (${...} 포함): 실제 키가 아니라 템플릿 리터럴
  const t_keys = new Set([...t_keys_raw].filter((k) => !k.includes("${")));
  console.log(`  t() calls: ${t_keys.size} unique keys across ${all_files.length} files (${t_keys_raw.size - t_keys.size} dynamic keys filtered)`);

  const { tool_names, expected_keys: tool_keys, tool_meta } = scan_backend_tools();
  console.log(`  Backend tools: ${tool_names.length} → ${tool_keys.size} expected keys`);

  const { node_types, expected_keys: node_keys, node_meta } = scan_frontend_nodes();
  console.log(`  Frontend nodes: ${node_types.length} → ${node_keys.size} expected keys`);

  // 모든 기대 키 합집합
  const all_expected = new Set([...t_keys, ...tool_keys, ...node_keys]);
  console.log(`  Total expected keys: ${all_expected.size}`);
  console.log();

  // 2. JSON 로드
  const en_path = resolve(LOCALES_DIR, "en.json");
  const ko_path = resolve(LOCALES_DIR, "ko.json");
  const en = load_json(en_path);
  const ko = load_json(ko_path);

  const en_keys = new Set(Object.keys(en));
  const ko_keys = new Set(Object.keys(ko));

  // 3. 분석
  const missing_en: string[] = [];
  const missing_ko: string[] = [];
  const orphan_en: string[] = [];

  for (const key of all_expected) {
    if (!en_keys.has(key)) missing_en.push(key);
    if (!ko_keys.has(key)) missing_ko.push(key);
  }

  for (const key of en_keys) {
    if (!all_expected.has(key)) orphan_en.push(key);
  }

  // ko에만 있고 en에 없는 키
  const ko_only: string[] = [];
  for (const key of ko_keys) {
    if (!en_keys.has(key)) ko_only.push(key);
  }

  // 4. 보고
  console.log(`[i18n-sync] en.json: ${en_keys.size} keys`);
  if (missing_en.length) {
    console.log(`  ✗ Missing from en.json (${missing_en.length}):`);
    for (const k of missing_en.sort().slice(0, 30)) console.log(`    - ${k}`);
    if (missing_en.length > 30) console.log(`    ... +${missing_en.length - 30} more`);
  } else {
    console.log("  ✓ All expected keys present");
  }

  if (orphan_en.length) {
    console.log(`  ⚠ Orphan keys in en.json (${orphan_en.length}):`);
    for (const k of orphan_en.sort().slice(0, 15)) console.log(`    - ${k}`);
    if (orphan_en.length > 15) console.log(`    ... +${orphan_en.length - 15} more`);
  }
  console.log();

  console.log(`[i18n-sync] ko.json: ${ko_keys.size} keys`);
  const untranslated = [...en_keys].filter((k) => !ko_keys.has(k));
  if (untranslated.length) {
    console.log(`  ✗ Untranslated (in en but not ko): ${untranslated.length}`);
    for (const k of untranslated.sort().slice(0, 15)) console.log(`    - ${k}`);
    if (untranslated.length > 15) console.log(`    ... +${untranslated.length - 15} more`);
  }

  if (missing_ko.length > untranslated.length) {
    const only_missing_ko = missing_ko.filter((k) => en_keys.has(k) && !ko_keys.has(k));
    if (only_missing_ko.length) {
      console.log(`  ✗ Missing from ko.json (not in en either): ${missing_ko.length - untranslated.length}`);
    }
  }

  if (ko_only.length) {
    console.log(`  ⚠ KO-only keys (not in en): ${ko_only.length}`);
    for (const k of ko_only.sort().slice(0, 10)) console.log(`    - ${k}`);
    if (ko_only.length > 10) console.log(`    ... +${ko_only.length - 10} more`);
  }
  console.log();

  // 5. --fix 모드: 스텁 추가 (소스에서 추출한 실제 값 우선)
  if (MODE === "fix") {
    // 소스에서 추출한 실제 description 맵 구축
    const source_values = new Map<string, string>();
    for (const t of tool_meta) {
      if (t.desc) source_values.set(`tool.${t.name}.desc`, t.desc);
    }
    for (const n of node_meta) {
      if (n.label) source_values.set(`node.${n.type}.label`, n.label);
      for (const [key, desc] of n.fields) source_values.set(key, desc);
    }

    let added_en = 0;
    let added_ko = 0;
    let enriched = 0;

    for (const key of missing_en.sort()) {
      en[key] = source_values.get(key) ?? key_to_stub(key);
      added_en++;
    }
    // 기존 placeholder 스텁을 실제 값으로 갱신
    for (const [key, real_val] of source_values) {
      if (en[key] && en[key] !== real_val && is_stub_value(en[key], key)) {
        en[key] = real_val;
        enriched++;
      }
    }
    for (const key of all_expected) {
      if (!ko_keys.has(key)) {
        ko[key] = en[key] ?? key_to_stub(key);
        added_ko++;
      }
    }

    const en_changed = added_en > 0 || enriched > 0;
    const ko_changed = added_ko > 0;
    if (en_changed) {
      save_json(en_path, en);
      console.log(`[i18n-sync] en.json: +${added_en} stubs, ${enriched} enriched from source`);
    }
    if (ko_changed) {
      save_json(ko_path, ko);
      console.log(`[i18n-sync] ko.json: +${added_ko} stubs`);
    }
    if (!en_changed && !ko_changed) {
      console.log("[i18n-sync] No changes needed — all keys present with real values.");
    }
  }

  // 6. --check 모드: exit code
  if (MODE === "check") {
    const total_missing = missing_en.length + untranslated.length;
    if (total_missing > 0) {
      console.log(`[i18n-sync] CHECK FAILED: ${total_missing} missing/untranslated keys`);
      process.exit(1);
    }
    console.log("[i18n-sync] CHECK PASSED");
  }

  // 요약
  console.log("[i18n-sync] Summary:");
  console.log(`  EN: ${en_keys.size} defined, ${missing_en.length} missing, ${orphan_en.length} orphan`);
  console.log(`  KO: ${ko_keys.size} defined, ${untranslated.length} untranslated`);
  console.log(`  Tools: ${tool_names.length}, Nodes: ${node_types.length}`);
}

/** i18n 키에서 사람이 읽을 수 있는 기본값 생성. */
function key_to_stub(key: string): string {
  // "node.git.label" → "Git"
  // "node.git.output.stdout" → "stdout"
  // "tool.exec.desc" → "exec"
  // "cat.flow" → "Flow"
  const parts = key.split(".");
  const last = parts[parts.length - 1];

  if (parts[0] === "node" && parts.length >= 3) {
    if (parts[2] === "label") return capitalize(parts[1].replace(/-/g, " "));
    if (parts[2] === "desc") return `${capitalize(parts[1].replace(/-/g, " "))} node`;
    // output/input field
    if (parts.length >= 4) return capitalize(parts[3].replace(/_/g, " "));
  }
  if (parts[0] === "tool" && parts.length >= 3) {
    if (parts[2] === "desc") return `${capitalize(parts[1].replace(/_/g, " "))} tool`;
    if (parts[2] === "param" && parts.length >= 4) return capitalize(parts[3].replace(/_/g, " "));
  }
  if (parts[0] === "cat") return capitalize(last);

  return capitalize(last.replace(/[_-]/g, " "));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** key_to_stub()로 생성된 placeholder인지 판별. 소스의 실제 값으로 교체할 대상. */
function is_stub_value(value: string, key: string): boolean {
  const expected_stub = key_to_stub(key);
  return value === expected_stub;
}

main();
