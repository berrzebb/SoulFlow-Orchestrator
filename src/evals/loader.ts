/** 파일 시스템에서 EvalDataset 로드. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import type { EvalDataset, EvalCase } from "./contracts.js";

/** 단일 JSON 파일에서 EvalDataset 로드. */
export function load_eval_dataset(file_path: string): EvalDataset {
  if (!existsSync(file_path)) throw new Error(`eval dataset not found: ${file_path}`);
  const raw = JSON.parse(readFileSync(file_path, "utf-8")) as unknown;
  return validate_dataset(raw, basename(file_path, extname(file_path)));
}

/** 디렉토리 내 모든 .json 파일을 EvalDataset[]로 로드. */
export function load_eval_datasets(dir_path: string): EvalDataset[] {
  if (!existsSync(dir_path)) return [];
  return readdirSync(dir_path)
    .filter((f) => extname(f) === ".json")
    .map((f) => load_eval_dataset(join(dir_path, f)));
}

/** raw JSON → EvalDataset 유효성 검증. */
function validate_dataset(raw: unknown, fallback_name: string): EvalDataset {
  if (!raw || typeof raw !== "object") throw new Error("eval dataset must be a JSON object");
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name : fallback_name;
  const description = typeof obj.description === "string" ? obj.description : undefined;

  if (!Array.isArray(obj.cases)) throw new Error("eval dataset must have a 'cases' array");
  const cases = obj.cases.map((c: unknown, i: number) => validate_case(c, i));

  return { name, description, cases };
}

function validate_case(raw: unknown, index: number): EvalCase {
  if (!raw || typeof raw !== "object") throw new Error(`eval case[${index}] must be an object`);
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : `case-${index}`;
  const input = typeof obj.input === "string" ? obj.input : undefined;
  if (!input) throw new Error(`eval case[${index}] must have an 'input' string`);

  const expected = typeof obj.expected === "string" ? obj.expected : undefined;
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string") : undefined;
  const metadata = obj.metadata && typeof obj.metadata === "object" ? obj.metadata as Record<string, unknown> : undefined;

  return { id, input, expected, tags, metadata };
}
