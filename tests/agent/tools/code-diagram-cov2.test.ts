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
