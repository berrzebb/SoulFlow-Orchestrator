/**
 * CodeDiagramTool — 미커버 분기 보충 (cov2).
 * er_diagram, call_graph, component_diagram, sequence_from_code,
 * implements_/extends 관계, show_private, 유틸 메서드 등.
 */
import { describe, it, expect } from "vitest";
import { CodeDiagramTool } from "@src/agent/tools/code-diagram.js";

const tool = new CodeDiagramTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await tool.execute(params);
  try { return JSON.parse(String(r)); } catch { return { raw: r }; }
}

// ══════════════════════════════════════════
// class_diagram — interface extends + implements
// ══════════════════════════════════════════

describe("CodeDiagramTool — class_diagram: interface extends", () => {
  it("interface extends interface → <|.. 관계 출력 (L138)", async () => {
    const source = `
      interface Animal { name: string; }
      interface Dog extends Animal { breed: string; }
    `;
    const r = await exec({ action: "class_diagram", source });
    expect(r.diagram).toContain("Animal");
    expect(r.diagram).toContain("Dog");
    expect(String(r.diagram)).toContain("<|..");
  });

  it("class implements interface → implements_ 루프 (L142-143)", async () => {
    const source = `
      interface Runnable { run(): void; }
      class Worker implements Runnable { run() {} }
    `;
    const r = await exec({ action: "class_diagram", source });
    expect(String(r.diagram)).toContain("Runnable");
    expect(String(r.diagram)).toContain("Worker");
  });

  it("show_private=true → private 멤버 포함 (L126)", async () => {
    const source = `
      class Foo {
        private secret: string;
        private doSecret() {}
        public visible: number;
      }
    `;
    const r = await exec({ action: "class_diagram", source, show_private: true });
    expect(String(r.diagram)).toContain("-");
  });

  it("source 없음 → error 반환 (L103)", async () => {
    const r = await exec({ action: "class_diagram", source: "const x = 1;" });
    expect(r.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// er_diagram — 관계 탐지 포함
// ══════════════════════════════════════════

describe("CodeDiagramTool — er_diagram", () => {
  it("빈 소스 → error (L480)", async () => {
    const r = await exec({ action: "er_diagram", source: "const x = 1;" });
    expect(r.error).toContain("no interfaces");
  });

  it("단순 인터페이스 → erDiagram 생성", async () => {
    const source = `
      interface User {
        id: number;
        name: string;
        email: string;
      }
    `;
    const r = await exec({ action: "er_diagram", source });
    expect(r.diagram_type).toBe("erDiagram");
    expect(String(r.diagram)).toContain("User");
  });

  it("두 인터페이스 간 관계 탐지 (L495-504)", async () => {
    const source = `
      interface Order {
        id: number;
        items: Item[];
        user: User;
      }
      interface Item {
        id: number;
        name: string;
      }
      interface User {
        id: number;
        name: string;
      }
    `;
    const r = await exec({ action: "er_diagram", source });
    expect(r.diagram_type).toBe("erDiagram");
    // 관계가 추가됨
    expect(Number(r.relationship_count)).toBeGreaterThan(0);
  });

  it("extends 관계 있는 인터페이스 (L519-521)", async () => {
    const source = `
      interface Base { id: number; }
      interface Child extends Base { name: string; }
    `;
    const r = await exec({ action: "er_diagram", source });
    expect(r.entity_count).toBe(2);
  });
});

// ══════════════════════════════════════════
// call_graph
// ══════════════════════════════════════════

describe("CodeDiagramTool — call_graph", () => {
  it("함수 선언 없음 → error (L557)", async () => {
    const r = await exec({ action: "call_graph", source: "const x = 1;" });
    expect(r.error).toContain("no functions");
  });

  it("화살표 함수 수집 (L547)", async () => {
    const source = `
      const helper = (x: number) => x + 1;
      const main = () => {
        return helper(5);
      };
    `;
    const r = await exec({ action: "call_graph", source });
    expect(r.diagram_type).toBe("call_graph");
  });

  it("클래스 메서드 수집 (L551-553)", async () => {
    const source = `
      class Service {
        process() {
          return this.validate();
        }
        validate() {
          return true;
        }
      }
    `;
    const r = await exec({ action: "call_graph", source });
    expect(r.diagram_type).toBe("call_graph");
  });

  it("function_name 지정 → 관련 엣지 필터링 (L583-584)", async () => {
    const source = `
      function main() { helper(); }
      function helper() { return 1; }
      function unrelated() { return 2; }
    `;
    const r = await exec({ action: "call_graph", source, function_name: "main" });
    expect(r.diagram_type).toBe("call_graph");
  });
});

// ══════════════════════════════════════════
// sequence_diagram — source 코드에서 생성
// ══════════════════════════════════════════

describe("CodeDiagramTool — sequence_diagram: source 기반", () => {
  it("actors/messages 없고 source 있음 → gen_sequence_from_code (L219)", async () => {
    const source = `const x = 1;`; // 클래스 없음 → error
    const r = await exec({ action: "sequence_diagram", source });
    expect(r.error).toContain("no classes");
  });

  it("클래스가 있지만 inter-object 호출 없음 → error (L246)", async () => {
    const source = `
      class Foo { doSomething() { return 1; } }
    `;
    const r = await exec({ action: "sequence_diagram", source });
    expect(r.error).toContain("no inter-object");
  });

  it("클래스 간 호출 있음 → sequenceDiagram 생성", async () => {
    const source = `
      class Client {
        run() { this.Service.process(); this.Repo.save(); }
      }
      class Service { process() {} }
      class Repo { save() {} }
    `;
    const r = await exec({ action: "sequence_diagram", source });
    // 일부 inter-object 호출 감지됨
    expect(r.diagram_type).toBe("sequenceDiagram");
  });
});

// ══════════════════════════════════════════
// component_diagram
// ══════════════════════════════════════════

describe("CodeDiagramTool — component_diagram", () => {
  it("sources 없음 → error (L625)", async () => {
    const r = await exec({ action: "component_diagram" });
    expect(r.error).toContain("sources required");
  });

  it("잘못된 sources JSON → error (L622)", async () => {
    const r = await exec({ action: "component_diagram", sources: "{invalid}" });
    expect(r.error).toContain("invalid sources JSON");
  });

  it("유효한 sources → component_diagram 생성 (L654-680)", async () => {
    const sources = JSON.stringify([
      { path: "src/a/foo.ts", code: `export function foo() {}` },
      { path: "src/b/bar.ts", code: `import { foo } from "../a/foo"; export function bar() {}` },
    ]);
    const r = await exec({ action: "component_diagram", sources });
    expect(r.diagram_type).toBe("component_diagram");
    expect(Number(r.component_count)).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// flowchart — 미커버 분기 (await, throw)
// ══════════════════════════════════════════

describe("CodeDiagramTool — flowchart: await/throw 분기", () => {
  it("await 문 → await 노드 생성 (L336-339)", async () => {
    const source = `
      async function fetchData() {
        await someService.getData();
        return result;
      }
    `;
    const r = await exec({ action: "flowchart", source, function_name: "fetchData" });
    expect(r.diagram_type).toBe("flowchart");
    expect(String(r.diagram)).toContain("await");
  });

  it("throw 문 → throw 노드 생성", async () => {
    const source = `
      function validate(x) {
        if (!x) throw new Error("invalid");
        return x;
      }
    `;
    const r = await exec({ action: "flowchart", source, function_name: "validate" });
    expect(r.diagram_type).toBe("flowchart");
  });

  it("try/catch 문 → try/catch 노드 생성", async () => {
    const source = `
      async function safe() {
        try {
          const r = await fetch(url);
          return r;
        } catch (e) {
          return null;
        }
      }
    `;
    const r = await exec({ action: "flowchart", source, function_name: "safe" });
    expect(r.diagram_type).toBe("flowchart");
  });
});

// ══════════════════════════════════════════
// dependency_graph — group_by_folder, require()
// ══════════════════════════════════════════

describe("CodeDiagramTool — dependency_graph: group_by_folder + require", () => {
  it("group_by_folder=true + 다폴더 → subgraph 생성 (L434-452)", async () => {
    const sources = JSON.stringify([
      { path: "src/a/foo.ts", code: `import { bar } from "../b/bar";` },
      { path: "src/b/bar.ts", code: `export function bar() {}` },
    ]);
    const r = await exec({ action: "dependency_graph", sources, group_by_folder: true });
    expect(r.diagram_type).toBe("dependency_graph");
    expect(String(r.diagram)).toContain("subgraph");
  });

  it("require() import 파싱 (L800-806)", async () => {
    const source = `
      const { foo, bar } = require('./utils');
      const baz = require('./baz');
    `;
    const r = await exec({ action: "dependency_graph", source });
    expect(r.diagram_type).toBe("dependency_graph");
  });

  it("type-only import → 점선 엣지 (-.->) 생성", async () => {
    const source = `import type { Foo } from './foo';`;
    const r = await exec({ action: "dependency_graph", source });
    expect(String(r.diagram)).toContain("-.->");
  });

  it("외부 패키지 import → external 노드 생성", async () => {
    const source = `import { something } from 'some-package';`;
    const r = await exec({ action: "dependency_graph", source });
    expect(String(r.diagram)).toContain("external");
  });

  it("scoped 패키지 (@org/pkg) → 패키지명 슬래시 2단계 추출", async () => {
    const source = `import { X } from '@anthropic-ai/sdk';`;
    const r = await exec({ action: "dependency_graph", source });
    expect(String(r.diagram)).toContain("anthropic-ai");
  });
});

// ══════════════════════════════════════════
// sequence_diagram — arrow type 분기 (L884-892)
// ══════════════════════════════════════════

describe("CodeDiagramTool — sequence_diagram: message type 분기", () => {
  const actors = JSON.stringify(["A", "B"]);

  it("type=async → -) 화살표", async () => {
    const messages = JSON.stringify([{ from: "A", to: "B", text: "call", type: "async" }]);
    const r = await exec({ action: "sequence_diagram", actors, messages });
    expect(String(r.diagram)).toContain("-)");
  });

  it("type=reply → -->> 화살표", async () => {
    const messages = JSON.stringify([{ from: "A", to: "B", text: "result", type: "reply" }]);
    const r = await exec({ action: "sequence_diagram", actors, messages });
    expect(String(r.diagram)).toContain("-->>");
  });

  it("type=dashed → --> 화살표", async () => {
    const messages = JSON.stringify([{ from: "A", to: "B", text: "notify", type: "dashed" }]);
    const r = await exec({ action: "sequence_diagram", actors, messages });
    expect(String(r.diagram)).toContain("-->");
  });

  it("type=activate → ->>+ 화살표", async () => {
    const messages = JSON.stringify([{ from: "A", to: "B", text: "start", type: "activate" }]);
    const r = await exec({ action: "sequence_diagram", actors, messages });
    expect(String(r.diagram)).toContain("->>+");
  });

  it("type=deactivate → ->>- 화살표", async () => {
    const messages = JSON.stringify([{ from: "A", to: "B", text: "end", type: "deactivate" }]);
    const r = await exec({ action: "sequence_diagram", actors, messages });
    expect(String(r.diagram)).toContain("->>-");
  });
});

// ══════════════════════════════════════════
// L107: direction !== "TB"
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// L126: private method + show_private=false → continue
// ══════════════════════════════════════════

describe("CodeDiagramTool — L126: private method skip", () => {
  it("class with private method + show_private=false → L126: continue (메서드 제외)", async () => {
    const result = await tool.execute({
      action: "class_diagram",
      source: "class Foo {\n  private bar() {}\n  public baz() {}\n}",
      show_private: false,
    });
    const parsed = JSON.parse(result);
    expect(parsed.diagram).not.toContain("-bar");
    expect(parsed.diagram).toContain("+baz");
  });
});

// ══════════════════════════════════════════
// L235: gen_sequence_from_code → this/console 필터
// ══════════════════════════════════════════

describe("CodeDiagramTool — L235: sequence filter (this/console)", () => {
  it("source에 this.helper() 호출 → L235: obj=this → continue (필터)", async () => {
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
    expect(typeof result).toBe("string");
  });
});

// ══════════════════════════════════════════
// L237: seen.has(key) → 중복 skip
// ══════════════════════════════════════════

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
    const parsed = JSON.parse(result);
    expect(typeof parsed.diagram).toBe("string");
  });
});

// ══════════════════════════════════════════
// L724-725: TypeScript type 정의 파싱
// ══════════════════════════════════════════

describe("CodeDiagramTool — L724-725: TypeScript type 정의 파싱", () => {
  it("type Config = { ... } → L724: extract_block, L725: classes.push", async () => {
    const result = await tool.execute({
      action: "class_diagram",
      source: "type Config = { name: string; value: number; }",
    });
    const parsed = JSON.parse(result);
    expect(parsed.diagram).toContain("Config");
    expect(parsed.class_count).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// L775: parse_methods keyword filter
// ══════════════════════════════════════════

describe("CodeDiagramTool — L775: parse_methods 키워드 필터", () => {
  it("class body에 if(...) 패턴 → L775: m[4]=if → continue (메서드 제외)", async () => {
    const source = `class Processor {
  process() { return true; }
  if (x > 0) { }
}`;
    const result = await tool.execute({
      action: "class_diagram",
      source,
    });
    const parsed = JSON.parse(result);
    expect(parsed.diagram).not.toContain("+if(");
    expect(parsed.diagram).toContain("process");
  });
});

// ══════════════════════════════════════════
// L797: parse_imports default + named import
// ══════════════════════════════════════════

describe("CodeDiagramTool — L797: parse_imports default+named import", () => {
  it("'import Foo, { bar, baz } from module' → L797: m[3] non-null → push named", async () => {
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

// ══════════════════════════════════════════
// L817: extract_block unclosed brace
// ══════════════════════════════════════════

describe("CodeDiagramTool — L817: extract_block unclosed brace", () => {
  it("닫는 } 없는 class 정의 → L817: source.slice(start) 반환", async () => {
    const result = await tool.execute({
      action: "class_diagram",
      source: "class Unclosed { name: string",
    });
    expect(typeof result).toBe("string");
  });
});

// ══════════════════════════════════════════
// L846: extract_condition fallback
// ══════════════════════════════════════════

describe("CodeDiagramTool — L846: extract_condition fallback", () => {
  it("switch 문에 괄호 없음 → extract_condition 정규식 불일치 → L846: stmt.slice(0,40)", async () => {
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

// ══════════════════════════════════════════
// L855-856-858: extract_switch_cases 8+ cases + default
// ══════════════════════════════════════════

describe("CodeDiagramTool — L855-856-858: extract_switch_cases", () => {
  it("9개 case labels + default: → L855(push) + L856(break at 8) + L858(default push)", async () => {
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
    expect(parsed.diagram).toContain("Switch");
  });
});

// ══════════════════════════════════════════
// L916: resolve_folder "." continue
// ══════════════════════════════════════════

describe("CodeDiagramTool — L916: resolve_folder '.' continue", () => {
  it("'./helper' import → resolve_folder: import_parts=['.'] → L916: part='.', continue", async () => {
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

// ══════════════════════════════════════════
// L931: er_type boolean → "bool"
// ══════════════════════════════════════════

describe("CodeDiagramTool — L931: er_type boolean", () => {
  it("entity field type=boolean → L931: er_type → 'bool'", async () => {
    const result = await tool.execute({
      action: "er_diagram",
      source: "type User = {\n  id: number;\n  name: string;\n  active: boolean;\n}",
    });
    const parsed = JSON.parse(result);
    expect(parsed.diagram).toContain("bool active");
  });
});
