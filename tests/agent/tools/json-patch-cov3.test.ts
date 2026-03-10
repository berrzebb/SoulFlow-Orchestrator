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
