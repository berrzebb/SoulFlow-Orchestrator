/**
 * YamlTool — 추가 미커버 분기 보충 (cov3).
 * L35: switch default, L74: validate_yaml catch,
 * L92: query_yaml catch, L142-146: parse_mapping 빈 값 → 네스팅,
 * L187: parse_sequence break, L251: to_yaml 비표준 타입 fallback.
 */
import { describe, it, expect } from "vitest";
import { YamlTool } from "@src/agent/tools/yaml.js";

// ══════════════════════════════════════════
// L35: switch default — 지원되지 않는 action
// ══════════════════════════════════════════

describe("YamlTool — switch default (L35)", () => {
  it("지원되지 않는 action → Error 문자열 반환", async () => {
    const tool = new YamlTool();
    // execute()는 enum 검증 없이 run()을 호출 → default 분기 도달
    const r = await tool.execute({ action: "unsupported_action", data: "x" });
    expect(r).toContain("Error: unsupported action \"unsupported_action\"");
  });
});

// ══════════════════════════════════════════
// L74: validate_yaml 예외 경로
// ══════════════════════════════════════════

describe("YamlTool — validate_yaml 예외 처리 (L74)", () => {
  it("yaml_parse 예외 → { valid: false, error } 반환", async () => {
    const tool = new YamlTool();
    // yaml_parse를 강제로 예외 발생하도록 교체
    (tool as any).yaml_parse = () => { throw new Error("invalid yaml structure"); };
    const r = (tool as any).validate_yaml("any input");
    const parsed = JSON.parse(r);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("invalid yaml structure");
  });
});

// ══════════════════════════════════════════
// L92: query_yaml 예외 경로
// ══════════════════════════════════════════

describe("YamlTool — query_yaml 예외 처리 (L92)", () => {
  it("yaml_parse 예외 → Error 문자열 반환", async () => {
    const tool = new YamlTool();
    (tool as any).yaml_parse = () => { throw new Error("parse failure"); };
    const r = (tool as any).query_yaml("any input", "some.path");
    expect(r).toContain("Error: parse failure");
  });
});

// ══════════════════════════════════════════
// L142-146: parse_mapping — 빈 val_str → 네스팅 블록
// ══════════════════════════════════════════

describe("YamlTool — parse_mapping 빈 val_str → 네스팅 (L142-146)", () => {
  it("'key: \\n  child: value' → colon_idx≥0 but empty val_str → 네스팅 객체", async () => {
    const tool = new YamlTool();
    // "parent: " 은 ": " 포함 (colon_idx=6) 이지만 이후 값이 없어 빈 val_str
    const yaml = "parent: \n  child: nested_value";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.parent).toBeDefined();
    expect(parsed.parent.child).toBe("nested_value");
  });

  it("다중 빈 val_str 키 → 각각 네스팅", async () => {
    const tool = new YamlTool();
    const yaml = "a: \n  x: 1\nb: \n  y: 2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.a?.x).toBe(1);
    expect(parsed.b?.y).toBe(2);
  });
});

// ══════════════════════════════════════════
// L187: parse_sequence — 비시퀀스 라인에서 break
// ══════════════════════════════════════════

describe("YamlTool — parse_sequence break (L187)", () => {
  it("시퀀스 후 비시퀀스 라인 → break, 시퀀스 항목만 반환", async () => {
    const tool = new YamlTool();
    const yaml = "- item1\n- item2\nkey: value";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain("item1");
    expect(parsed).toContain("item2");
    // "key: value" 부분은 break로 인해 무시됨
  });
});

// ══════════════════════════════════════════
// L251: to_yaml — 비표준 타입 fallback (String(val))
// ══════════════════════════════════════════

describe("YamlTool — to_yaml 비표준 타입 fallback (L251)", () => {
  it("BigInt → String(val) 반환", () => {
    const tool = new YamlTool();
    // BigInt: typeof === 'bigint', null/boolean/number/string/Array/object 모두 아님 → L251
    const r = (tool as any).to_yaml(BigInt(42), 0, 2);
    expect(r).toContain("42");
  });
});

// ══════════════════════════════════════════
// L42: parse_yaml catch → Error 문자열
// ══════════════════════════════════════════

describe("YamlTool — parse_yaml catch (L42)", () => {
  it("yaml_parse 예외 → parse_yaml catch → Error 문자열 (L42)", () => {
    const tool = new YamlTool();
    (tool as any).yaml_parse = () => { throw new Error("parse error in yaml"); };
    const r = (tool as any).parse_yaml("any yaml");
    expect(r).toContain("Error: parse error in yaml");
  });
});

// ══════════════════════════════════════════
// L65: merge_yaml catch → Error 문자열
// ══════════════════════════════════════════

describe("YamlTool — merge_yaml catch (L65)", () => {
  it("yaml_parse 예외 → merge_yaml catch → Error 문자열 (L65)", () => {
    const tool = new YamlTool();
    (tool as any).yaml_parse = () => { throw new Error("merge parse error"); };
    const r = (tool as any).merge_yaml("yaml1", "yaml2");
    expect(r).toContain("Error: merge parse error");
  });
});

// ══════════════════════════════════════════
// L130: parse_mapping 빈 줄 skip (base_indent=0, i=임의, !trimmed)
// L127: parse_mapping dedent break (base_indent>0, i>0, indent<base_indent)
// ══════════════════════════════════════════

describe("YamlTool — parse_mapping 빈 줄 처리 (L127/L130)", () => {
  it("최상위 매핑 내 빈 줄 → L130 skip (base_indent=0)", async () => {
    const tool = new YamlTool();
    // a: 1 \n \n b: 2 → cleaned에 빈 줄 포함, base_indent=0이라 L127 미작동, L130으로 skip
    const yaml = "a: 1\n\nb: 2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(2);
  });

  it("중첩 매핑 내 빈 줄 → L127 break (base_indent=2, indent=0)", async () => {
    const tool = new YamlTool();
    // child_lines: ["  first: val", "", "  second: other"]
    // parse_mapping(base_indent=2): i=1 시 indent=0 < 2 → L127 break
    const yaml = "parent:\n  first: val\n\n  second: other";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    // first만 파싱됨 (empty line에서 break)
    expect(parsed.parent?.first).toBe("val");
  });
});

// ══════════════════════════════════════════
// L173: parse_sequence 빈 줄 skip (base_indent=0)
// L170: parse_sequence dedent break (base_indent>0, i>0, indent<base_indent)
// ══════════════════════════════════════════

describe("YamlTool — parse_sequence 빈 줄 처리 (L170/L173)", () => {
  it("최상위 시퀀스 내 빈 줄 → L173 skip (base_indent=0)", async () => {
    const tool = new YamlTool();
    // cleaned: ["- item1", "", "- item2"] → base_indent=0, i=1: 0<0 false, L173 fires
    const yaml = "- item1\n\n- item2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain("item1");
    expect(parsed).toContain("item2");
  });

  it("중첩 시퀀스 내 빈 줄 → L170 break (base_indent=2, indent=0)", async () => {
    const tool = new YamlTool();
    // child_lines: ["  - item1", "", "  - item2"]
    // parse_sequence(base_indent=2): i=1 시 indent=0 < 2 → L170 break
    const yaml = "list:\n  - item1\n\n  - item2";
    const r = await tool.execute({ action: "parse", data: yaml });
    const parsed = JSON.parse(r);
    expect(Array.isArray(parsed.list)).toBe(true);
    // item1만 파싱됨 (empty line에서 break)
    expect(parsed.list).toContain("item1");
  });
});
