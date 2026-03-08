/**
 * JsonPatchTool — 미커버 분기 보충.
 * remove/replace(배열 대상), apply_patch test/move/copy/default op,
 * validate 누락 op/path 검사, diff scalar/null 경계, set_value "-" 추가.
 */
import { describe, it, expect } from "vitest";
import { JsonPatchTool } from "@src/agent/tools/json-patch.js";

function make(): JsonPatchTool {
  return new JsonPatchTool();
}

// ══════════════════════════════════════════
// apply — validate patch must be array
// ══════════════════════════════════════════

describe("JsonPatchTool — apply 입력 검증", () => {
  it("patch가 배열 아닌 객체 → Error: patch must be an array", async () => {
    const r = await make().execute({
      action: "apply",
      document: '{"a":1}',
      patch: '{"op":"add","path":"/b","value":2}',
    });
    expect(r).toContain("patch must be an array");
  });

  it("document JSON 파싱 실패 → Error: invalid document JSON", async () => {
    const r = await make().execute({ action: "apply", document: "{bad", patch: "[]" });
    expect(r).toContain("invalid document JSON");
  });

  it("patch JSON 파싱 실패 → Error: invalid patch JSON", async () => {
    const r = await make().execute({ action: "apply", document: '{"a":1}', patch: "[bad" });
    expect(r).toContain("invalid patch JSON");
  });
});

// ══════════════════════════════════════════
// apply — remove: 배열 대상 + 객체 대상
// ══════════════════════════════════════════

describe("JsonPatchTool — apply remove op", () => {
  it("배열 원소 remove (splice)", async () => {
    const doc = JSON.stringify([10, 20, 30]);
    const patch = JSON.stringify([{ op: "remove", path: "/1" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result).toEqual([10, 30]);
  });

  it("객체 키 remove", async () => {
    const doc = JSON.stringify({ a: 1, b: 2 });
    const patch = JSON.stringify([{ op: "remove", path: "/b" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result).toEqual({ a: 1 });
  });

  it("없는 경로 remove → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "remove", path: "/z" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("path not found");
  });
});

// ══════════════════════════════════════════
// apply — replace: 배열/객체 대상
// ══════════════════════════════════════════

describe("JsonPatchTool — apply replace op", () => {
  it("배열 원소 replace", async () => {
    const doc = JSON.stringify(["a", "b", "c"]);
    const patch = JSON.stringify([{ op: "replace", path: "/1", value: "X" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result).toEqual(["a", "X", "c"]);
  });

  it("객체 키 replace", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "replace", path: "/a", value: 99 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result.a).toBe(99);
  });

  it("없는 경로 replace → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "replace", path: "/z", value: 0 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("path not found");
  });
});

// ══════════════════════════════════════════
// apply — test op
// ══════════════════════════════════════════

describe("JsonPatchTool — apply test op", () => {
  it("test 성공 → 문서 변경 없음", async () => {
    const doc = JSON.stringify({ a: 42 });
    const patch = JSON.stringify([{ op: "test", path: "/a", value: 42 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result).toEqual({ a: 42 });
  });

  it("test 실패 → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "test", path: "/a", value: 99 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("test failed");
  });

  it("test 경로 없음 → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "test", path: "/z", value: 0 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("path not found");
  });
});

// ══════════════════════════════════════════
// apply — move op
// ══════════════════════════════════════════

describe("JsonPatchTool — apply move op", () => {
  it("move: from → to", async () => {
    const doc = JSON.stringify({ a: 1, b: 2 });
    const patch = JSON.stringify([{ op: "move", from: "/a", path: "/c" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result.c).toBe(1);
    expect(r.result.a).toBeUndefined();
  });

  it("move from 없음 → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "move", path: "/b" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("move requires from");
  });

  it("move from 경로 없음 → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "move", from: "/z", path: "/b" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("from path not found");
  });

  it("배열에서 move (splice)", async () => {
    const doc = JSON.stringify({ arr: [10, 20], x: 0 });
    const patch = JSON.stringify([{ op: "move", from: "/arr/0", path: "/x" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result.x).toBe(10);
    expect(r.result.arr).toEqual([20]);
  });
});

// ══════════════════════════════════════════
// apply — copy op
// ══════════════════════════════════════════

describe("JsonPatchTool — apply copy op", () => {
  it("copy: from → to", async () => {
    const doc = JSON.stringify({ a: 42 });
    const patch = JSON.stringify([{ op: "copy", from: "/a", path: "/b" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result.b).toBe(42);
    expect(r.result.a).toBe(42); // 원본 유지
  });

  it("copy from 없음 → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "copy", path: "/b" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("copy requires from");
  });

  it("copy from 경로 없음 → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "copy", from: "/z", path: "/b" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("from path not found");
  });
});

// ══════════════════════════════════════════
// apply — unknown op (default case)
// ══════════════════════════════════════════

describe("JsonPatchTool — apply unknown op", () => {
  it("알 수 없는 op → error", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "unknown_op", path: "/a" }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.error).toContain("unknown operation");
  });
});

// ══════════════════════════════════════════
// test action (apply mode로 test)
// ══════════════════════════════════════════

describe("JsonPatchTool — test action", () => {
  it("test 성공 → success: true", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "test", path: "/a", value: 1 }]);
    const r = JSON.parse(await make().execute({ action: "test", document: doc, patch }));
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("test 실패 → success: false + error 포함", async () => {
    const doc = JSON.stringify({ a: 1 });
    const patch = JSON.stringify([{ op: "test", path: "/a", value: 99 }]);
    const r = JSON.parse(await make().execute({ action: "test", document: doc, patch }));
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// validate — 상세 오류 케이스
// ══════════════════════════════════════════

describe("JsonPatchTool — validate 상세", () => {
  it("배열 아닌 patch → valid: false", async () => {
    const r = JSON.parse(await make().execute({ action: "validate", patch: '{"not":"array"}' }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("patch must be an array");
  });

  it("op 없는 원소 → valid: false", async () => {
    const r = JSON.parse(await make().execute({ action: "validate", patch: '[{"path":"/a"}]' }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("missing op or path");
  });

  it("알 수 없는 op → valid: false", async () => {
    const r = JSON.parse(await make().execute({ action: "validate", patch: '[{"op":"bad","path":"/a"}]' }));
    expect(r.valid).toBe(false);
    expect(r.error).toContain("unknown op");
  });

  it("유효한 patch → valid: true, count 반환", async () => {
    const patch = JSON.stringify([
      { op: "add", path: "/a", value: 1 },
      { op: "remove", path: "/b" },
    ]);
    const r = JSON.parse(await make().execute({ action: "validate", patch }));
    expect(r.valid).toBe(true);
    expect(r.count).toBe(2);
  });
});

// ══════════════════════════════════════════
// diff — scalar/null 경계, 빈 diff
// ══════════════════════════════════════════

describe("JsonPatchTool — diff 경계 케이스", () => {
  it("동일 객체 → patch 없음", async () => {
    const doc = JSON.stringify({ a: 1 });
    const r = JSON.parse(await make().execute({ action: "diff", document: doc, target: doc }));
    expect(r.patch).toHaveLength(0);
  });

  it("null → 값 → replace", async () => {
    const r = JSON.parse(await make().execute({ action: "diff", document: "null", target: '"hello"' }));
    expect(r.patch.length).toBeGreaterThan(0);
    expect(r.patch[0].op).toBe("replace");
  });

  it("string → number → replace (scalar)", async () => {
    const r = JSON.parse(await make().execute({ action: "diff", document: '"hello"', target: "42" }));
    expect(r.patch.length).toBeGreaterThan(0);
  });

  it("객체 키 추가/제거 → add/remove 포함", async () => {
    const source = JSON.stringify({ a: 1, b: 2 });
    const target = JSON.stringify({ a: 1, c: 3 });
    const r = JSON.parse(await make().execute({ action: "diff", document: source, target }));
    const ops = r.patch.map((p: { op: string }) => p.op);
    expect(ops).toContain("remove");
    expect(ops).toContain("add");
  });

  it("diff target JSON 파싱 실패 → Error", async () => {
    const r = await make().execute({ action: "diff", document: '{"a":1}', target: "{bad" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// set_value — "-" 배열 끝 추가, 중간 경로 생성
// ══════════════════════════════════════════

describe("JsonPatchTool — set_value edge cases", () => {
  it('"-" 인덱스로 배열 끝에 add', async () => {
    const doc = JSON.stringify({ arr: [1, 2] });
    const patch = JSON.stringify([{ op: "add", path: "/arr/-", value: 3 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result.arr).toEqual([1, 2, 3]);
  });

  it("중간 경로 없는 경우 자동 생성", async () => {
    const doc = JSON.stringify({});
    const patch = JSON.stringify([{ op: "add", path: "/a/b", value: 42 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result.a.b).toBe(42);
  });

  it("path='' → 문서 전체 교체", async () => {
    const doc = JSON.stringify({ a: 1 });
    // path="" add는 전체 교체 (RFC 6902에서는 특수케이스)
    const patch = JSON.stringify([{ op: "add", path: "", value: 99 }]);
    const r = JSON.parse(await make().execute({ action: "apply", document: doc, patch }));
    expect(r.result).toBe(99);
  });
});

// ══════════════════════════════════════════
// default action
// ══════════════════════════════════════════

describe("JsonPatchTool — 알 수 없는 action", () => {
  it("unknown action → Error", async () => {
    const r = await make().execute({ action: "unknown", document: "{}" });
    expect(r).toContain("unsupported action");
  });
});
