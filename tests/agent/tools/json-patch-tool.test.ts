/**
 * JsonPatchTool — apply/diff/validate/test 테스트 (RFC 6902).
 */
import { describe, it, expect } from "vitest";
import { JsonPatchTool } from "../../../src/agent/tools/json-patch.js";

const tool = new JsonPatchTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const DOC = JSON.stringify({ name: "Alice", age: 30, tags: ["a", "b"] });

describe("JsonPatchTool — apply", () => {
  it("add 연산 — 새 필드 추가", async () => {
    const patch = JSON.stringify([{ op: "add", path: "/email", value: "alice@example.com" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    expect((r.result as Record<string, unknown>).email).toBe("alice@example.com");
  });

  it("remove 연산 — 필드 제거", async () => {
    const patch = JSON.stringify([{ op: "remove", path: "/age" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    expect((r.result as Record<string, unknown>).age).toBeUndefined();
  });

  it("replace 연산 — 필드 교체", async () => {
    const patch = JSON.stringify([{ op: "replace", path: "/name", value: "Bob" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    expect((r.result as Record<string, unknown>).name).toBe("Bob");
  });

  it("배열에 add 연산 (-로 append)", async () => {
    const patch = JSON.stringify([{ op: "add", path: "/tags/-", value: "c" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    const tags = (r.result as Record<string, unknown>).tags as string[];
    expect(tags).toContain("c");
    expect(tags.length).toBe(3);
  });

  it("move 연산", async () => {
    const patch = JSON.stringify([{ op: "move", from: "/name", path: "/fullname" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.fullname).toBe("Alice");
    expect(result.name).toBeUndefined();
  });

  it("copy 연산", async () => {
    const patch = JSON.stringify([{ op: "copy", from: "/name", path: "/name2" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    const result = r.result as Record<string, unknown>;
    expect(result.name).toBe("Alice");
    expect(result.name2).toBe("Alice");
  });

  it("test 연산 성공", async () => {
    const patch = JSON.stringify([{ op: "test", path: "/name", value: "Alice" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    expect(r.result).toBeDefined();
    expect(r.error).toBeUndefined();
  });

  it("test 연산 실패 → error", async () => {
    const patch = JSON.stringify([{ op: "test", path: "/name", value: "Wrong" }]);
    const r = await exec({ action: "apply", document: DOC, patch }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("빈 패치 → 문서 그대로", async () => {
    const r = await exec({ action: "apply", document: DOC, patch: "[]" }) as Record<string, unknown>;
    expect((r.result as Record<string, unknown>).name).toBe("Alice");
  });

  it("잘못된 document JSON → Error", async () => {
    const r = await exec({ action: "apply", document: "{invalid", patch: "[]" });
    expect(String(r)).toContain("Error");
  });

  it("잘못된 patch JSON → Error", async () => {
    const r = await exec({ action: "apply", document: DOC, patch: "not-json" });
    expect(String(r)).toContain("Error");
  });
});

describe("JsonPatchTool — diff", () => {
  it("소스와 타깃 차이 생성", async () => {
    const source = JSON.stringify({ a: 1, b: 2 });
    const target = JSON.stringify({ a: 1, b: 3, c: 4 });
    const r = await exec({ action: "diff", document: source, target }) as Record<string, unknown>;
    expect(r.count).toBeGreaterThan(0);
    expect(Array.isArray(r.patch)).toBe(true);
  });

  it("동일한 문서 → 빈 패치", async () => {
    const r = await exec({ action: "diff", document: DOC, target: DOC }) as Record<string, unknown>;
    expect(r.count).toBe(0);
    expect((r.patch as unknown[]).length).toBe(0);
  });

  it("필드 제거 → remove 연산 포함", async () => {
    const source = JSON.stringify({ a: 1, b: 2 });
    const target = JSON.stringify({ a: 1 });
    const r = await exec({ action: "diff", document: source, target }) as Record<string, unknown>;
    const ops = (r.patch as { op: string }[]).map(p => p.op);
    expect(ops).toContain("remove");
  });
});

describe("JsonPatchTool — validate", () => {
  it("유효한 패치 → valid: true", async () => {
    const patch = JSON.stringify([
      { op: "add", path: "/foo", value: "bar" },
      { op: "remove", path: "/baz" },
    ]);
    const r = await exec({ action: "validate", patch }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.count).toBe(2);
  });

  it("잘못된 op → valid: false", async () => {
    const patch = JSON.stringify([{ op: "unknown_op", path: "/foo" }]);
    const r = await exec({ action: "validate", patch }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("op/path 누락 → valid: false", async () => {
    const patch = JSON.stringify([{ op: "add" }]);
    const r = await exec({ action: "validate", patch }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("잘못된 JSON → valid: false", async () => {
    const r = await exec({ action: "validate", patch: "{bad" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});

describe("JsonPatchTool — test (action)", () => {
  it("패치 적용 성공 → success: true", async () => {
    const patch = JSON.stringify([{ op: "test", path: "/name", value: "Alice" }]);
    const r = await exec({ action: "test", document: DOC, patch }) as Record<string, unknown>;
    expect(r.success).toBe(true);
  });

  it("패치 적용 실패 → success: false", async () => {
    const patch = JSON.stringify([{ op: "test", path: "/name", value: "Wrong" }]);
    const r = await exec({ action: "test", document: DOC, patch }) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });
});

// L177: set_value에서 last_key === "-" → array.push (RFC 6902 배열 끝 추가)
describe("JsonPatchTool — add op: path/-  (배열 끝 추가, L177)", () => {
  it("배열에 /- 경로로 add → 배열 끝에 push", async () => {
    const doc = JSON.stringify({ items: [1, 2, 3] });
    const patch = JSON.stringify([{ op: "add", path: "/items/-", value: 99 }]);
    const r = await exec({ action: "apply", document: doc, patch }) as any;
    expect(r.result.items).toEqual([1, 2, 3, 99]);
  });

  it("빈 배열에 /- 경로로 add → [value]", async () => {
    const doc = JSON.stringify({ list: [] });
    const patch = JSON.stringify([{ op: "add", path: "/list/-", value: "first" }]);
    const r = await exec({ action: "apply", document: doc, patch }) as any;
    expect(r.result.list).toEqual(["first"]);
  });
});
