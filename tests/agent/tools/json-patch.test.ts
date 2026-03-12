/**
 * JsonPatchTool — 미커버 분기 보충 (3차).
 * resolve_pointer edge / remove·replace·test·move·copy 배열+에러 경로 / set_value array splice.
 */
import { describe, it, expect } from "vitest";
import { JsonPatchTool } from "../../../src/agent/tools/json-patch.js";

const tool = new JsonPatchTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const raw = await tool.execute(params);
  try { return JSON.parse(String(raw)); } catch { return raw; }
}

// ── diff: 잘못된 document JSON (L41)
describe("JsonPatchTool — diff 입력 오류", () => {
  it("diff: invalid document → Error (L41)", async () => {
    const r = await exec({ action: "diff", document: "{bad", target: '{"a":1}' });
    expect(String(r)).toContain("Error");
  });
});

// ── test action: invalid doc/patch JSON (L62, L63)
describe("JsonPatchTool — test action 입력 오류", () => {
  it("test: invalid document JSON → Error (L62)", async () => {
    const r = await exec({ action: "test", document: "{bad", patch: "[]" });
    expect(String(r)).toContain("Error");
  });

  it("test: invalid patch JSON → Error (L63)", async () => {
    const r = await exec({ action: "test", document: '{"a":1}', patch: "[bad" });
    expect(String(r)).toContain("Error");
  });
});

// ── resolve_pointer: path="" → parent=null (L73), then remove triggers L96
describe("JsonPatchTool — resolve_pointer path='' (L73, L96)", () => {
  it("remove path='' → resolved.parent===null → error (L73+L96)", async () => {
    const r = await exec({ action: "apply", document: '{"a":1}', patch: '[{"op":"remove","path":""}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });
});

// ── resolve_pointer: 중간 경로가 비객체 (L77) → null 반환 → remove L96
describe("JsonPatchTool — resolve_pointer 비객체 중간 경로 (L77)", () => {
  it("remove: 중간 경로가 number → resolve null → error (L77+L96)", async () => {
    // parts=["a","b","c"] → i=0: ok, i=1: current=5(number) → L77 return null → L96
    const doc = JSON.stringify({ a: 5 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"remove","path":"/a/b/c"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });
});

// ── remove: 배열 인덱스 out-of-bounds (L99)
describe("JsonPatchTool — remove array out-of-bounds (L99)", () => {
  it("remove /5 on length-3 array → error (L99)", async () => {
    const doc = JSON.stringify([1, 2, 3]);
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"remove","path":"/5"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });
});

// ── replace: resolved.parent===null (L109)
describe("JsonPatchTool — replace parent=null (L109)", () => {
  it("replace path='' → parent===null → error (L109)", async () => {
    const r = await exec({ action: "apply", document: '{"a":1}', patch: '[{"op":"replace","path":"","value":99}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });
});

// ── replace: 배열 인덱스 out-of-bounds (L112)
describe("JsonPatchTool — replace array out-of-bounds (L112)", () => {
  it("replace /5 on length-2 array → error (L112)", async () => {
    const doc = JSON.stringify([1, 2]);
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"replace","path":"/5","value":99}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });
});

// ── test op: resolve null (L122)
describe("JsonPatchTool — test op resolve null (L122)", () => {
  it("test op 3단계 비객체 경로 → resolve null → error (L122)", async () => {
    // parts=["a","b","c"] → i=1: current=1(number) → L77 null → L122 !resolved
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"test","path":"/a/b/c","value":1}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });
});

// ── move: from parent=null (L136)
describe("JsonPatchTool — move from parent=null (L136)", () => {
  it("move from 3단계 비객체 경로 → resolve null → error (L136)", async () => {
    // parts=["a","b","c"] → i=1: current=1(number) → L77 null → L136 !from_resolved
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"move","from":"/a/b/c","path":"/d"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("from path not found");
  });
});

// ── copy: from resolve null (L147)
describe("JsonPatchTool — copy from resolve null (L147)", () => {
  it("copy from 3단계 비객체 경로 → resolve null → error (L147)", async () => {
    // parts=["a","b","c"] → i=1: current=1(number) → L77 null → L147 !from_resolved
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"copy","from":"/a/b/c","path":"/d"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("from path not found");
  });
});

// ── set_value: 배열 숫자 인덱스 splice (L177)
describe("JsonPatchTool — set_value array splice (L177)", () => {
  it("add /1 on array → splice at index 1 (L177)", async () => {
    const doc = JSON.stringify([10, 20, 30]);
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"add","path":"/1","value":99}]' }) as Record<string, unknown>;
    expect(r.result).toEqual([10, 99, 20, 30]);
  });
});

// ── 추가 미커버 분기 ──────────────────────────────────────────
describe("JsonPatchTool — 추가 미커버 분기", () => {
  it("diff: invalid target JSON → Error (L42)", async () => {
    const r = await exec({ action: "diff", document: '{"a":1}', target: "{bad" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("invalid target JSON");
  });

  it("unknown action → Error (L68)", async () => {
    const r = await exec({ action: "unknown_op" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("unsupported");
  });

  it("remove from array /0 → L100 splice (성공)", async () => {
    const doc = JSON.stringify([1, 2, 3]);
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"remove","path":"/0"}]' }) as Record<string, unknown>;
    expect(r.result).toEqual([2, 3]);
  });

  it("remove /missing_key from object → L102 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"remove","path":"/missing_key"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });

  it("replace array[1] → L113 parent[idx]=value (성공)", async () => {
    const doc = JSON.stringify([10, 20, 30]);
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"replace","path":"/1","value":99}]' }) as Record<string, unknown>;
    expect(r.result).toEqual([10, 99, 30]);
  });

  it("replace /missing from object → L115 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"replace","path":"/missing","value":99}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });

  it("test op key not found → L127 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"test","path":"/nonexistent","value":1}]' }) as Record<string, unknown>;
    expect(r.error).toContain("path not found");
  });

  it("move without from → L134 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"move","path":"/b"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("from");
  });

  it("move from key not found → L137 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"move","from":"/nonexistent","path":"/b"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("from path not found");
  });

  it("move from array /0 → L139 splice (성공)", async () => {
    const doc = JSON.stringify({ arr: [10, 20], b: 0 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"move","from":"/arr/0","path":"/b"}]' }) as Record<string, unknown>;
    expect((r.result as Record<string, unknown>).b).toBe(10);
  });

  it("copy without from → L145 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"copy","path":"/b"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("from");
  });

  it("copy from key not found → L148 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"copy","from":"/nonexistent","path":"/b"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("from path not found");
  });

  it("unknown op → L153 error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"bogus","path":"/a"}]' }) as Record<string, unknown>;
    expect(r.error).toContain("unknown operation");
  });

  it("add path='' → L160 return value (전체 문서 교체)", async () => {
    const r = await exec({ action: "apply", document: '{"a":1}', patch: '[{"op":"add","path":"","value":{"x":99}}]' }) as Record<string, unknown>;
    expect(r.result).toEqual({ x: 99 });
  });

  it("add /new/nested → L168 자동 중간 객체 생성", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = await exec({ action: "apply", document: doc, patch: '[{"op":"add","path":"/new/nested","value":42}]' }) as Record<string, unknown>;
    expect((r.result as Record<string, unknown>).new).toEqual({ nested: 42 });
  });

  it("diff: type mismatch at root → L189 replace path='/'", async () => {
    const r = await exec({ action: "diff", document: '"string"', target: '{"a":1}' }) as Record<string, unknown>;
    expect(Array.isArray(r.patch)).toBe(true);
    expect((r.patch as unknown[])[0]).toMatchObject({ op: "replace" });
  });
});
