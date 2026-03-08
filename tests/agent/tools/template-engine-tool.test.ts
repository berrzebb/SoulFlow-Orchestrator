/**
 * TemplateTool — Mustache 스타일 템플릿 렌더링 테스트.
 */
import { describe, it, expect } from "vitest";
import { TemplateTool } from "../../../src/agent/tools/template-engine.js";

const tool = new TemplateTool();

async function exec(params: Record<string, unknown>): Promise<string> {
  return String(await tool.execute(params));
}

describe("TemplateTool — 변수 보간", () => {
  it("기본 변수 치환", async () => {
    const r = await exec({
      template: "Hello, {{name}}!",
      data: JSON.stringify({ name: "Alice" }),
    });
    expect(r).toBe("Hello, Alice!");
  });

  it("없는 변수 → 빈 문자열", async () => {
    const r = await exec({
      template: "Hello, {{missing}}!",
      data: JSON.stringify({}),
    });
    expect(r).toBe("Hello, !");
  });

  it("숫자 변수 치환", async () => {
    const r = await exec({
      template: "{{name}} is {{age}} years old",
      data: JSON.stringify({ name: "Bob", age: 30 }),
    });
    expect(r).toBe("Bob is 30 years old");
  });

  it("중첩 경로 (dot notation)", async () => {
    const r = await exec({
      template: "{{user.name}}",
      data: JSON.stringify({ user: { name: "Carol" } }),
    });
    expect(r).toBe("Carol");
  });
});

describe("TemplateTool — 조건부 {{#if}}", () => {
  it("truthy → if 블록 출력", async () => {
    const r = await exec({
      template: "{{#if active}}Active{{/if}}",
      data: JSON.stringify({ active: true }),
    });
    expect(r).toBe("Active");
  });

  it("falsy → if 블록 미출력", async () => {
    const r = await exec({
      template: "{{#if active}}Active{{/if}}",
      data: JSON.stringify({ active: false }),
    });
    expect(r).toBe("");
  });

  it("else 블록", async () => {
    const r = await exec({
      template: "{{#if active}}Active{{else}}Inactive{{/if}}",
      data: JSON.stringify({ active: false }),
    });
    expect(r).toBe("Inactive");
  });
});

describe("TemplateTool — 반복 {{#each}}", () => {
  it("객체 배열 반복 — 필드 접근", async () => {
    const r = await exec({
      template: "{{#each users}}{{name}},{{/each}}",
      data: JSON.stringify({ users: [{ name: "Alice" }, { name: "Bob" }] }),
    });
    expect(r).toBe("Alice,Bob,");
  });

  it("each 내부 {{#if}} 조건 처리", async () => {
    const r = await exec({
      template: "{{#each items}}{{#if active}}{{name}} {{/if}}{{/each}}",
      data: JSON.stringify({ items: [{ name: "Alice", active: true }, { name: "Bob", active: false }] }),
    });
    expect(r).toContain("Alice");
    expect(r).not.toContain("Bob");
  });

  it("배열 아닌 값에서 each → 빈 문자열", async () => {
    const r = await exec({
      template: "{{#each notarray}}{{name}}{{/each}}",
      data: JSON.stringify({ notarray: "string" }),
    });
    expect(r).toBe("");
  });
});

describe("TemplateTool — {{#unless}}", () => {
  it("falsy → unless 블록 출력", async () => {
    const r = await exec({
      template: "{{#unless active}}Disabled{{/unless}}",
      data: JSON.stringify({ active: false }),
    });
    expect(r).toBe("Disabled");
  });

  it("truthy → unless 블록 미출력", async () => {
    const r = await exec({
      template: "{{#unless active}}Disabled{{/unless}}",
      data: JSON.stringify({ active: true }),
    });
    expect(r).toBe("");
  });
});

describe("TemplateTool — helpers", () => {
  it("upper helper", async () => {
    const r = await exec({
      template: "{{upper name}}",
      data: JSON.stringify({ name: "alice" }),
    });
    expect(r).toBe("ALICE");
  });

  it("lower helper", async () => {
    const r = await exec({
      template: "{{lower name}}",
      data: JSON.stringify({ name: "ALICE" }),
    });
    expect(r).toBe("alice");
  });

  it("json helper", async () => {
    const r = await exec({
      template: "{{json data}}",
      data: JSON.stringify({ data: { x: 1 } }),
    });
    expect(r).toContain('"x"');
  });

  it("length helper", async () => {
    const r = await exec({
      template: "{{length items}}",
      data: JSON.stringify({ items: [1, 2, 3] }),
    });
    expect(r).toBe("3");
  });
});

describe("TemplateTool — partials", () => {
  it("partial 렌더링", async () => {
    const r = await exec({
      template: "Hello {{> greeting}}!",
      data: JSON.stringify({ name: "World" }),
      partials: JSON.stringify({ greeting: "{{name}}" }),
    });
    expect(r).toBe("Hello World!");
  });

  it("없는 partial → 원본 유지", async () => {
    const r = await exec({
      template: "{{> missing}}",
      data: JSON.stringify({}),
      partials: JSON.stringify({}),
    });
    expect(r).toBe("{{> missing}}");
  });
});

describe("TemplateTool — 에러 처리", () => {
  it("template 없음 → Error", async () => {
    expect(await exec({ template: "" })).toContain("Error");
  });

  it("data 잘못된 JSON → Error", async () => {
    expect(await exec({ template: "{{x}}", data: "not-json" })).toContain("Error");
  });

  it("partials 잘못된 JSON → Error", async () => {
    expect(await exec({ template: "{{x}}", partials: "not-json" })).toContain("Error");
  });
});
