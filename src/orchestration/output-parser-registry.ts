/**
 * SO-3: OutputParserRegistry.
 *
 * 출력 포맷별 파서를 레지스트리로 관리. NodeRegistry 패턴과 동일.
 * OCP: 새 포맷 = parser 1개 + register 1줄.
 */

import { parse_tool_calls_from_text } from "../agent/tool-call-parser.js";

// ── Types ───────────────────────────────────────────────────────

/** 지원 출력 포맷. 확장 시 string 유니온 확장. */
export type OutputFormat = "json" | "tool_calls" | "text" | (string & {});

/** 출력 파서 계약. format을 키로 레지스트리에 등록. */
export interface OutputParser<T = unknown> {
  readonly format: OutputFormat;
  parse(raw: string): T | null;
}

// ── Registry ────────────────────────────────────────────────────

const registry = new Map<string, OutputParser>();

/** 파서 등록. 동일 format 중복 등록 시 에러. */
export function register_output_parser(parser: OutputParser): void {
  if (registry.has(parser.format)) {
    throw new Error(`duplicate output parser: ${parser.format}`);
  }
  registry.set(parser.format, parser);
}

/** 포맷에 대응하는 파서 조회. */
export function get_output_parser(format: string): OutputParser | undefined {
  return registry.get(format);
}

/** 등록된 모든 포맷 이름 반환. */
export function list_output_parsers(): string[] {
  return [...registry.keys()];
}

/** 포맷을 지정하여 파싱. 미등록 포맷이면 null 반환. */
export function parse_output(format: string, raw: string): unknown {
  const parser = registry.get(format);
  if (!parser) return null;
  return parser.parse(raw);
}

// ── Built-in Parsers ────────────────────────────────────────────

const json_parser: OutputParser = {
  format: "json",
  parse(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  },
};

const tool_calls_parser: OutputParser = {
  format: "tool_calls",
  parse(raw: string) {
    return parse_tool_calls_from_text(raw);
  },
};

const text_parser: OutputParser<string> = {
  format: "text",
  parse(raw: string) {
    return raw.trim();
  },
};

// ── Auto-registration ───────────────────────────────────────────

register_output_parser(json_parser);
register_output_parser(tool_calls_parser);
register_output_parser(text_parser);
