#!/usr/bin/env tsx
/**
 * 노드 descriptor의 toolbar_label + schema description을 i18n 키로 변환.
 * 일괄 자동 변환 스크립트 (일회성).
 *
 * Usage: npx tsx scripts/i18n-convert-nodes.ts
 *        npx tsx scripts/i18n-convert-nodes.ts --dry-run
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const NODES_DIR = resolve(ROOT, "web/src/pages/workflows/nodes");
const DRY_RUN = process.argv.includes("--dry-run");

let total_files = 0;
let total_changes = 0;

for (const entry of readdirSync(NODES_DIR)) {
  if (!entry.endsWith(".tsx") || entry === "index.ts") continue;
  const file = resolve(NODES_DIR, entry);
  let src = readFileSync(file, "utf-8");

  // node_type 추출
  const type_match = src.match(/node_type\s*:\s*["']([^"']+)["']/);
  if (!type_match) continue;
  const node_type = type_match[1];
  let changes = 0;

  // 1. toolbar_label: "+ Git" → "node.git.label"
  src = src.replace(
    /toolbar_label\s*:\s*"[^"]+"/,
    (m) => {
      const new_val = `toolbar_label: "node.${node_type}.label"`;
      if (m !== new_val) { changes++; return new_val; }
      return m;
    },
  );

  // 2. output_schema description → i18n 키
  src = replace_schema_descriptions(src, "output_schema", node_type, "output", () => changes++);

  // 3. input_schema description → i18n 키
  src = replace_schema_descriptions(src, "input_schema", node_type, "input", () => changes++);

  if (changes > 0) {
    total_files++;
    total_changes += changes;
    if (DRY_RUN) {
      console.log(`[dry-run] ${basename(file)}: ${changes} changes`);
    } else {
      writeFileSync(file, src, "utf-8");
      console.log(`${basename(file)}: ${changes} changes`);
    }
  }
}

console.log(`\nTotal: ${total_files} files, ${total_changes} changes${DRY_RUN ? " (dry-run)" : ""}`);

function replace_schema_descriptions(
  src: string,
  schema_key: string,
  node_type: string,
  direction: "input" | "output",
  on_change: () => void,
): string {
  // 각 schema 배열 내 { name: "xxx", ..., description: "yyy" } 패턴을 찾아 변환
  const schema_re = new RegExp(`(${schema_key}\\s*:\\s*\\[)([\\s\\S]*?)(\\])`, "m");
  return src.replace(schema_re, (_, open, body, close) => {
    const new_body = body.replace(
      /(\{\s*name\s*:\s*"([^"]+)"[^}]*description\s*:\s*)"([^"]+)"/g,
      (_m: string, prefix: string, field_name: string, _desc: string) => {
        const i18n_key = `node.${node_type}.${direction}.${field_name}`;
        on_change();
        return `${prefix}"${i18n_key}"`;
      },
    );
    return open + new_body + close;
  });
}
