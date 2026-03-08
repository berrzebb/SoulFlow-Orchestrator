/**
 * CodeDiagramTool 커버리지 — 7개 액션 완전 테스트.
 */
import { describe, it, expect } from "vitest";
import { CodeDiagramTool } from "@src/agent/tools/code-diagram.js";

const tool = new CodeDiagramTool();

// ── 샘플 소스 코드 ────────────────────────────────────

const TS_CLASS = `
export class Animal {
  protected name: string;
  private age: number;
  static count: number = 0;

  constructor(name: string) {
    this.name = name;
  }

  public getName(): string {
    return this.name;
  }

  protected bark(): void {}
}

export class Dog extends Animal {
  private breed: string;

  public fetch(item: string): Promise<string> {
    return Promise.resolve(item);
  }
}

export interface Pet {
  name: string;
  owner: string;
}

export enum Status {
  Active,
  Inactive,
}

abstract class Vehicle {
  abstract move(): void;
}
`;

const TS_IMPORTS = `
import { readFile } from "node:fs";
import type { FileHandle } from "node:fs";
import { Component } from "./component.js";
import { Service } from "../services/service.js";
import express from "express";
import { join } from "node:path";
`;

const TS_FUNCTION = `
function processData(input: string): string {
  if (input.length > 100) {
    return input.slice(0, 100);
  }
  for (const char of input) {
    console.log(char);
  }
  try {
    const result = JSON.parse(input);
    return result;
  } catch (e) {
    throw new Error("invalid JSON");
  }
}
`;

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("CodeDiagramTool — 메타데이터", () => {
  it("name = code_diagram", () => expect(tool.name).toBe("code_diagram"));
  it("category = diagram", () => expect(tool.category).toBe("diagram"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// class_diagram
// ══════════════════════════════════════════

describe("CodeDiagramTool — class_diagram", () => {
  it("클래스 파싱 → classDiagram 반환", async () => {
    const r = await tool.execute({ action: "class_diagram", source: TS_CLASS });
    const parsed = JSON.parse(r);
    expect(parsed.format).toBe("mermaid");
    expect(parsed.diagram_type).toBe("classDiagram");
    expect(parsed.class_count).toBeGreaterThan(0);
    expect(parsed.diagram).toContain("classDiagram");
    expect(parsed.diagram).toContain("Animal");
    expect(parsed.diagram).toContain("Dog");
  });

  it("상속 관계 → <|-- 포함", async () => {
    const r = await tool.execute({ action: "class_diagram", source: TS_CLASS });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("<|--");
  });

  it("인터페이스 → <<interface>> 포함", async () => {
    const r = await tool.execute({ action: "class_diagram", source: TS_CLASS });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("<<interface>>");
  });

  it("enum → <<enumeration>> 포함", async () => {
    const r = await tool.execute({ action: "class_diagram", source: TS_CLASS });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("<<enumeration>>");
  });

  it("abstract class → <<abstract>> 포함", async () => {
    const r = await tool.execute({ action: "class_diagram", source: TS_CLASS });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("<<abstract>>");
  });

  it("show_private=true → private 멤버 포함", async () => {
    const r = await tool.execute({ action: "class_diagram", source: TS_CLASS, show_private: true });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("-");
  });

  it("클래스 없음 → error 반환", async () => {
    const r = await tool.execute({ action: "class_diagram", source: "const x = 1;" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("no classes");
  });
});

// ══════════════════════════════════════════
// sequence_diagram
// ══════════════════════════════════════════

describe("CodeDiagramTool — sequence_diagram", () => {
  it("actors + messages → sequenceDiagram 반환", async () => {
    const r = await tool.execute({
      action: "sequence_diagram",
      actors: JSON.stringify(["Client", "Server"]),
      messages: JSON.stringify([
        { from: "Client", to: "Server", text: "request()" },
        { from: "Server", to: "Client", text: "response()", type: "return" },
      ]),
    });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("sequenceDiagram");
    expect(parsed.diagram).toContain("Client");
    expect(parsed.diagram).toContain("Server");
  });

  it("type=reply → -->> 화살표", async () => {
    const r = await tool.execute({
      action: "sequence_diagram",
      actors: JSON.stringify([]),
      messages: JSON.stringify([{ from: "A", to: "B", text: "ok", type: "reply" }]),
    });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("-->>");
  });

  it("type=async → -) 화살표", async () => {
    const r = await tool.execute({
      action: "sequence_diagram",
      actors: JSON.stringify([]),
      messages: JSON.stringify([{ from: "A", to: "B", text: "call", type: "async" }]),
    });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("-)");
  });

  it("messages 없음 + source → 코드 분석", async () => {
    const source = `
      class OrderService {
        placeOrder() { this.inventoryService.checkStock(); }
      }
      class InventoryService {
        checkStock() { return true; }
      }
    `;
    const r = await tool.execute({
      action: "sequence_diagram",
      actors: "[]",
      messages: "[]",
      source,
    });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("sequenceDiagram");
  });

  it("messages 없음 + source 없음 → error 반환", async () => {
    const r = await tool.execute({ action: "sequence_diagram", actors: "[]", messages: "[]" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toBeDefined();
  });

  it("잘못된 actors JSON → error 반환", async () => {
    const r = await tool.execute({ action: "sequence_diagram", actors: "{bad json}", messages: "[]" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("actors");
  });

  it("잘못된 messages JSON → error 반환", async () => {
    const r = await tool.execute({ action: "sequence_diagram", actors: "[]", messages: "bad" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("messages");
  });
});

// ══════════════════════════════════════════
// flowchart
// ══════════════════════════════════════════

describe("CodeDiagramTool — flowchart", () => {
  it("함수 소스 → flowchart 반환", async () => {
    const r = await tool.execute({ action: "flowchart", source: TS_FUNCTION });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("flowchart");
    expect(parsed.diagram).toContain("flowchart");
    expect(parsed.node_count).toBeGreaterThan(0);
  });

  it("direction LR → flowchart LR", async () => {
    const r = await tool.execute({ action: "flowchart", source: TS_FUNCTION, direction: "LR" });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("flowchart LR");
  });

  it("function_name 지정 → 해당 함수 추출", async () => {
    const r = await tool.execute({
      action: "flowchart",
      source: TS_FUNCTION,
      function_name: "processData",
    });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("flowchart");
    expect(parsed.node_count).toBeGreaterThan(0);
  });

  it("없는 function_name → error 반환", async () => {
    const r = await tool.execute({ action: "flowchart", source: TS_FUNCTION, function_name: "nonExistent" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("not found");
  });

  it("source 없음 → error 반환", async () => {
    const r = await tool.execute({ action: "flowchart", source: "" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("source required");
  });

  it("switch문 포함 소스 → Switch 노드 생성", async () => {
    const source = `
      function handle(type) {
        switch(type) {
          case 'a': return 'A';
          case 'b': return 'B';
        }
      }
    `;
    const r = await tool.execute({ action: "flowchart", source });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("Switch");
  });

  it("while문 포함 소스 → Loop 노드 생성", async () => {
    const source = `
function loop() {
  while (true) {
    process();
  }
}`;
    const r = await tool.execute({ action: "flowchart", source });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("Loop");
  });
});

// ══════════════════════════════════════════
// dependency_graph
// ══════════════════════════════════════════

describe("CodeDiagramTool — dependency_graph", () => {
  it("single source → graph 반환", async () => {
    const r = await tool.execute({ action: "dependency_graph", source: TS_IMPORTS });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("dependency_graph");
    expect(parsed.diagram).toContain("graph");
  });

  it("multi sources → 다중 파일 분석", async () => {
    const sources = JSON.stringify([
      { path: "src/a.ts", code: "import { B } from './b.js';" },
      { path: "src/b.ts", code: "import { C } from './c.js';" },
    ]);
    const r = await tool.execute({ action: "dependency_graph", sources });
    const parsed = JSON.parse(r);
    expect(parsed.module_count).toBeGreaterThan(0);
  });

  it("group_by_folder → subgraph 포함", async () => {
    const sources = JSON.stringify([
      { path: "services/a.ts", code: "import { B } from './b.js';" },
      { path: "utils/b.ts", code: "import { x } from 'express';" },
    ]);
    const r = await tool.execute({ action: "dependency_graph", sources, group_by_folder: true });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("subgraph");
  });

  it("잘못된 sources JSON → error 반환", async () => {
    const r = await tool.execute({ action: "dependency_graph", sources: "{bad}" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("sources");
  });

  it("source/sources 없음 → error 반환", async () => {
    const r = await tool.execute({ action: "dependency_graph" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("source");
  });

  it("외부 패키지 임포트 → (external) 표시", async () => {
    const r = await tool.execute({ action: "dependency_graph", source: "import express from 'express';" });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("external");
  });

  it("@scoped 패키지 → 올바르게 파싱", async () => {
    const r = await tool.execute({ action: "dependency_graph", source: "import { fn } from '@org/pkg/module';" });
    const parsed = JSON.parse(r);
    expect(parsed.module_count).toBeGreaterThan(0);
  });

  it("type-only import → -.-> 엣지", async () => {
    const r = await tool.execute({
      action: "dependency_graph",
      source: "import type { Foo } from './foo.js';",
    });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("-.->"); // type-only
  });

  it("require() import → 파싱", async () => {
    const r = await tool.execute({
      action: "dependency_graph",
      source: "const { readFile } = require('node:fs');",
    });
    const parsed = JSON.parse(r);
    expect(parsed.module_count).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// er_diagram
// ══════════════════════════════════════════

describe("CodeDiagramTool — er_diagram", () => {
  it("클래스 소스 → erDiagram 반환", async () => {
    const r = await tool.execute({ action: "er_diagram", source: TS_CLASS });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("erDiagram");
    expect(parsed.diagram).toContain("erDiagram");
  });

  it("entity와 속성 포함", async () => {
    const source = `
      interface User {
        id: number;
        name: string;
        email: string;
        createdAt: Date;
      }
    `;
    const r = await tool.execute({ action: "er_diagram", source });
    const parsed = JSON.parse(r);
    expect(parsed.diagram).toContain("User");
  });
});

// ══════════════════════════════════════════
// call_graph
// ══════════════════════════════════════════

describe("CodeDiagramTool — call_graph", () => {
  it("함수 호출 → call graph 반환", async () => {
    const source = `
      function a() { b(); c(); }
      function b() { d(); }
      function c() { d(); }
      function d() { return 1; }
    `;
    const r = await tool.execute({ action: "call_graph", source });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("call_graph");
    expect(parsed.diagram).toContain("graph");
  });

  it("function_name 필터 → 해당 함수 중심", async () => {
    const source = `
      function main() { helper(); }
      function helper() { return 1; }
    `;
    const r = await tool.execute({ action: "call_graph", source, function_name: "main" });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("call_graph");
  });
});

// ══════════════════════════════════════════
// component_diagram
// ══════════════════════════════════════════

describe("CodeDiagramTool — component_diagram", () => {
  it("여러 소스 → component 다이어그램", async () => {
    const sources = JSON.stringify([
      { path: "frontend/app.ts", code: "import { Api } from '../backend/api.ts';" },
      { path: "backend/api.ts", code: "export class Api {}" },
    ]);
    const r = await tool.execute({ action: "component_diagram", sources });
    const parsed = JSON.parse(r);
    expect(parsed.diagram_type).toBe("component_diagram");
    expect(parsed.diagram).toContain("graph");
  });

  it("single source → sources 없음 → error 반환", async () => {
    const r = await tool.execute({
      action: "component_diagram",
      source: "import { Button } from './button.js';\nexport class Form {}",
    });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("sources required");
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("CodeDiagramTool — unknown action", () => {
  it("unknown → error 반환", async () => {
    const r = await tool.execute({ action: "timeline" });
    const parsed = JSON.parse(r);
    expect(parsed.error).toContain("unknown action");
  });
});
