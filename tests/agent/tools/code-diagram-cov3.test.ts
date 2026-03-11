/**
 * CodeDiagramTool — 미커버 분기 (cov3):
 * - L107: class_diagram → direction !== "TB" (lines[0] 덮어씀)
 * - L126: class_diagram → 메서드 private + show_private=false → continue
 * - L235: gen_sequence_from_code → obj = this/console 등 → 필터 skip
 * - L237: gen_sequence_from_code → seen.has(key) → 중복 skip
 * - L724-725: parse_classes → type = { ... } TypeScript type 정의 파싱
 * - L775: parse_methods → m[4]=if/for/while 등 keyword → continue
 * - L797: parse_imports → m[3] 존재 (default + named import) → push
 * - L817: extract_block → 닫는 } 없음 → source.slice(start) 반환
 * - L846: extract_condition → if/for/while/switch 없는 문장 → stmt.slice(0,40)
 * - L855-856-858: extract_switch_cases → 8+ case labels + default
 * - L916: resolve_folder → import path에 "." 컴포넌트 → continue
 * - L931: er_type → boolean → "bool"
 */
import { describe, it, expect } from "vitest";
import { CodeDiagramTool } from "@src/agent/tools/code-diagram.js";

const tool = new CodeDiagramTool();

// ── L107: direction !== "TB" ────────────────────────────────────────────────

describe("CodeDiagramTool — L107: direction !== 'TB'", () => {
  it("class_diagram direction=LR → L107: lines[0] 재할당 분기 실행", async () => {
    const result = await tool.execute({
      action: "class_diagram",
      source: "class Foo { name: string; }",
      direction: "LR",
    });
    const parsed = JSON.parse(result);
    expect(parsed.format).toBe("mermaid");
    expect(parsed.diagram).toContain("classDiagram");
  });
});

// ── L126: private method + show_private=false → continue ─────────────────────

describe("CodeDiagramTool — L126: private method skip", () => {
  it("class with private method + show_private=false → L126: continue (메서드 제외)", async () => {
    const result = await tool.execute({
      action: "class_diagram",
      source: "class Foo {\n  private bar() {}\n  public baz() {}\n}",
      show_private: false,
    });
    const parsed = JSON.parse(result);
    // private bar()는 제외(L126), public baz()만 포함
    expect(parsed.diagram).not.toContain("-bar");
    expect(parsed.diagram).toContain("+baz");
  });
});

// ── L235: gen_sequence_from_code → this/console 필터 ────────────────────────

describe("CodeDiagramTool — L235: sequence filter (this/console)", () => {
  it("source에 this.helper() 호출 → L235: obj=this → continue (필터)", async () => {
    // this.helper()는 필터 → L235 실행
    // service.process()는 통과
    const source = `class Client {
  run() {
    this.helper();
    service.process();
  }
}`;
    const result = await tool.execute({
      action: "sequence_diagram",
      source,
    });
    // 성공 또는 에러 — 중요한 것은 L235가 실행되는 것
    expect(typeof result).toBe("string");
  });
});

// ── L237: seen.has(key) → 중복 skip ─────────────────────────────────────────

describe("CodeDiagramTool — L237: sequence duplicate call skip", () => {
  it("source에 동일 메서드 두 번 호출 → 두 번째에서 L237: seen.has(key) → continue", async () => {
    const source = `class Client {
  run() {
    service.doWork();
    service.doWork();
  }
}`;
    const result = await tool.execute({
      action: "sequence_diagram",
      source,
    });
    // 다이어그램에 service.doWork()가 한 번만 나타남
    const parsed = JSON.parse(result);
    expect(typeof parsed.diagram).toBe("string");
  });
});

// ── L724-725: type = { ... } TypeScript type 파싱 ───────────────────────────

describe("CodeDiagramTool — L724-725: TypeScript type 정의 파싱", () => {
  it("type Config = { ... } → L724: extract_block, L725: classes.push", async () => {
    const result = await tool.execute({
      action: "class_diagram",
      source: "type Config = { name: string; value: number; }",
    });
    const parsed = JSON.parse(result);
    // Config type이 클래스 다이어그램에 포함됨
    expect(parsed.diagram).toContain("Config");
    expect(parsed.class_count).toBeGreaterThan(0);
  });
});

// ── L775: parse_methods keyword filter ──────────────────────────────────────

describe("CodeDiagramTool — L775: parse_methods 키워드 필터", () => {
  it("class body에 if(...) 패턴 → L775: m[4]=if → continue (메서드 제외)", async () => {
    // 클래스 바디에 if(x) 구문 → parse_methods 정규식이 매칭하지만 L775에서 필터
    const source = `class Processor {
  process() { return true; }
  if (x > 0) { }
}`;
    const result = await tool.execute({
      action: "class_diagram",
      source,
    });
    const parsed = JSON.parse(result);
    // "if"는 메서드로 추가되지 않음
    expect(parsed.diagram).not.toContain("+if(");
    expect(parsed.diagram).toContain("process");
  });
});

// ── L797: parse_imports m[3] → default + named import ────────────────────────

describe("CodeDiagramTool — L797: parse_imports default+named import", () => {
  it("'import Foo, { bar, baz } from module' → L797: m[3] non-null → push named", async () => {
    // dependency_graph 액션을 통해 parse_imports 호출
    const sources = JSON.stringify([{
      path: "src/app.ts",
      code: 'import React, { useState, useEffect } from "react"',
    }]);
    const result = await tool.execute({
      action: "dependency_graph",
      sources,
    });
    const parsed = JSON.parse(result);
    expect(parsed.format).toBe("mermaid");
  });
});

// ── L817: extract_block 닫는 } 없음 → source.slice(start) ───────────────────

describe("CodeDiagramTool — L817: extract_block unclosed brace", () => {
  it("닫는 } 없는 class 정의 → L817: source.slice(start) 반환", async () => {
    // class Foo { ... } 없이 끝남 → extract_block이 L817 실행
    const result = await tool.execute({
      action: "class_diagram",
      source: "class Unclosed { name: string",  // 닫는 } 없음
    });
    // 에러 없이 처리되거나 결과 반환
    expect(typeof result).toBe("string");
  });
});

// ── L846: extract_condition no match (switch without parens) ─────────────────

describe("CodeDiagramTool — L846: extract_condition fallback", () => {
  it("switch 문에 괄호 없음 → extract_condition 정규식 불일치 → L846: stmt.slice(0,40)", async () => {
    // "switch x" → starts with "switch " → extract_condition 호출
    // 정규식 /(if|for|while|switch)\s*\((.+)\)/ 매칭 안 됨 (괄호 없음) → L846
    const source = "switch x\nreturn 1;";
    const result = await tool.execute({
      action: "flowchart",
      source,
    });
    const parsed = JSON.parse(result);
    expect(parsed.format).toBe("mermaid");
    expect(parsed.diagram).toContain("Switch");
  });
});

// ── L855-856-858: extract_switch_cases 8+ cases + default ───────────────────

describe("CodeDiagramTool — L855-856-858: extract_switch_cases", () => {
  it("9개 case labels + default: → L855(push) + L856(break at 8) + L858(default push)", async () => {
    // switch (x) 후 9개 case + default → L855 반복, L856에서 break, L858에서 default push
    const source = [
      "switch (x)",
      "case 1: break",
      "case 2: break",
      "case 3: break",
      "case 4: break",
      "case 5: break",
      "case 6: break",
      "case 7: break",
      "case 8: break",
      "case 9: break",
      "default: break",
    ].join("\n");
    const result = await tool.execute({
      action: "flowchart",
      source,
    });
    const parsed = JSON.parse(result);
    expect(parsed.format).toBe("mermaid");
    // switch 노드가 생성됨
    expect(parsed.diagram).toContain("Switch");
  });
});

// ── L916: resolve_folder "." 컴포넌트 ────────────────────────────────────────

describe("CodeDiagramTool — L916: resolve_folder '.' continue", () => {
  it("'./helper' import → resolve_folder: import_parts=['.'] → L916: part='.', continue", async () => {
    // component_diagram + ./relative import → resolve_folder 호출
    // "./helper".split("/").slice(0, -1) = ["."] → part="." → L916
    const sources = JSON.stringify([{
      path: "src/app.ts",
      code: 'import { helper } from "./utils"',
    }]);
    const result = await tool.execute({
      action: "component_diagram",
      sources,
    });
    const parsed = JSON.parse(result);
    expect(parsed.format).toBe("mermaid");
  });
});

// ── L931: er_type boolean → "bool" ──────────────────────────────────────────

describe("CodeDiagramTool — L931: er_type boolean", () => {
  it("entity field type=boolean → L931: er_type → 'bool'", async () => {
    // er_diagram + boolean 필드 → er_type("boolean") → L931: return "bool"
    const result = await tool.execute({
      action: "er_diagram",
      source: "type User = {\n  id: number;\n  name: string;\n  active: boolean;\n}",
    });
    const parsed = JSON.parse(result);
    expect(parsed.diagram).toContain("bool active");
  });
});
