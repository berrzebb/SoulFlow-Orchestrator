/**
 * data-format.ts — 미커버 분기 (cov3):
 * - L280: yaml_serialize(null/undefined) → "${pad}null\n" 반환
 * - L281: yaml_serialize(boolean/number) → "${pad}${data}\n" 반환
 * - L233: yaml_parse_block — line_indent < indent → break
 * - L234: yaml_parse_block — line_indent > indent && i > start → break
 *
 * L280/L281은 최상위(top-level) 직렬화 대상이 null/primitive일 때 실행됨.
 * 기존 테스트는 항상 객체/배열을 넘기므로 L300(inline fallback)만 실행됨.
 */
import { describe, it, expect } from "vitest";
import { DataFormatTool } from "@src/agent/tools/data-format.js";

const tool = new DataFormatTool();

async function run(operation: string, input: string, extra: Record<string, unknown> = {}): Promise<string> {
  return tool.execute({ operation, input, ...extra });
}

// ── L280: yaml_serialize(null) → "null\n" ─────────────────────────────────

describe("DataFormatTool — L280: yaml_serialize(null) → 'null\\n'", () => {
  it("JSON null → YAML: top-level null 직렬화 → L280 실행", async () => {
    // JSON.parse("null") = null → yaml_serialize(null, 0) → L280
    const r = await run("convert", "null", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("null");
  });

  it("JSON undefined-like (null in JSON) → YAML 변환 → L280", async () => {
    // 배열의 첫 번째 원소가 객체이고, yaml_serialize(obj, indent+1)로 재귀 진입 후
    // 해당 객체 값에 null이 있는 경우도 L300을 타지만,
    // 최상위 null 변환이 가장 직접적인 경로
    const r = await run("convert", "null", { from: "json", to: "yaml" });
    expect(r).toContain("null");
  });
});

// ── L281: yaml_serialize(boolean/number) ─────────────────────────────────

describe("DataFormatTool — L281: yaml_serialize(boolean/number) → primitive 직렬화", () => {
  it("JSON true → YAML: top-level boolean → L281", async () => {
    // JSON.parse("true") = true → yaml_serialize(true, 0) → L281
    const r = await run("convert", "true", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("true");
  });

  it("JSON false → YAML → L281", async () => {
    const r = await run("convert", "false", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("false");
  });

  it("JSON 42 → YAML: top-level number → L281", async () => {
    // JSON.parse("42") = 42 → yaml_serialize(42, 0) → L281
    const r = await run("convert", "42", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("42");
  });

  it("JSON 3.14 → YAML → L281", async () => {
    const r = await run("convert", "3.14", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("3.14");
  });
});

// ── L233/L234: yaml_parse_block — indentation break ─────────────────────

describe("DataFormatTool — L233/L234: yaml_parse_block 들여쓰기 break 경로", () => {
  it("중첩 객체에서 들여쓰기 감소 → L233 break → 파싱 종료", async () => {
    // YAML 파싱 시 들여쓰기가 갑자기 줄어드는 구조 → L233: line_indent < indent → break
    const yaml = "outer:\n  inner: value\ntop_level: again";
    const r = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(r.outer).toBeDefined();
    expect(r.top_level).toBeDefined();
  });

  it("깊이 중첩 후 들여쓰기 증가 (i > start) → L234 break", async () => {
    // key: value 파싱 중 다음 라인이 더 들여쓰기 (예: 하위 객체의 하위) → L234
    const yaml = "a:\n  b: 1\n  c: 2\nd: 3";
    const r = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(r.a?.b).toBe(1);  // yaml_parse_value("1") → parseInt("1") = 1
    expect(r.d).toBe(3);
  });
});
