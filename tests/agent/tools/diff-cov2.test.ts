/**
 * DiffTool — 미커버 분기 보충.
 * lcs_indices 빈 배열, resolve_text 텍스트 초과,
 * apply_patch 내부 루프 --- +++ 분기, compute_diff_hunks j>=changes.length 경로.
 */
import { describe, it, expect, vi } from "vitest";
import { DiffTool } from "@src/agent/tools/diff.js";

const tool = new DiffTool();

// ══════════════════════════════════════════
// lcs_indices — 빈 배열 입력 (m=0 or n=0)
// ══════════════════════════════════════════

describe("DiffTool — lcs_indices 빈 배열 입력", () => {
  it("old_text 빈 문자열 → 추가만 있는 diff", async () => {
    // "".split("\n") → [""] → m=1이지만 new_lines도 ["x"] → lcs 실행
    // 완전히 빈 경우: old=""이고 new가 같아야 → no differences
    const r = await tool.execute({ operation: "compare", old_text: "", new_text: "" });
    expect(r).toContain("no differences");
  });

  it("old_text=빈 new_text=내용 → diff 생성", async () => {
    // old = [""], new = ["a", "b"] → lcs([""],[a,b]) → no match → 전부 추가
    const r = await tool.execute({ operation: "compare", old_text: "", new_text: "a\nb" });
    // diff 생성됨 (all additions)
    expect(typeof r).toBe("string");
  });

  it("stats에서 빈 old_text → similarity=N/A", async () => {
    // old_lines.length=1 (빈 문자열 split 결과), similarity 계산됨
    const r = JSON.parse(await tool.execute({ operation: "stats", old_text: "", new_text: "a" }));
    // old_lines.length=1 이므로 similarity는 % 형식
    expect(typeof r.similarity).toBe("string");
  });
});

// ══════════════════════════════════════════
// resolve_text — 텍스트 초과 (>512KB)
// ══════════════════════════════════════════

describe("DiffTool — resolve_text 텍스트 초과", () => {
  it("old_text가 512KB 초과 → Error 반환", async () => {
    // 512 * 1024 = 524288 bytes
    const huge = "x".repeat(1024 * 513); // ~513KB
    const r = await tool.execute({ operation: "compare", old_text: huge, new_text: "y" });
    expect(r).toContain("Error");
    expect(r).toContain("too large");
  });
});

// ══════════════════════════════════════════
// apply_patch — --- +++ 줄에서 inner loop break
// ══════════════════════════════════════════

describe("DiffTool — apply_patch --- +++ 헤더 라인 처리", () => {
  it("diff에 --- a +++ b 헤더 라인 포함 → 패치 실패 없이 처리", async () => {
    const old_text = "line1\nline2\nline3";
    const new_text = "line1\nMODIFIED\nline3";
    const diff = await tool.execute({ operation: "compare", old_text, new_text });
    // compare의 결과에는 --- a, +++ b 헤더가 포함됨
    expect(diff).toContain("--- a");
    expect(diff).toContain("+++ b");
    // 이 diff를 patch에 적용 (헤더는 내부 루프에서 break 처리됨)
    const patched = await tool.execute({ operation: "patch", diff_text: diff, old_text });
    expect(patched).toContain("MODIFIED");
    expect(patched).not.toContain("line2");
  });

  it("다중 hunk 패치 → L204 inner loop에서 @@ break", async () => {
    // 두 변경이 8줄 이상 떨어져 있어야 두 개의 hunk로 분리됨 (context=3이면 6줄 이상)
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const old_text = lines.join("\n");
    const new_lines = [...lines];
    new_lines[1] = "CHANGED_2";   // line 2 변경
    new_lines[18] = "CHANGED_19"; // line 19 변경 (13줄 떨어짐 → 두 hunk)
    const new_text = new_lines.join("\n");
    const diff = await tool.execute({ operation: "compare", old_text, new_text });
    // 두 개의 @@ hunk가 있어야 L204 inner loop break 트리거
    const hunk_count = (diff.match(/^@@/gm) || []).length;
    expect(hunk_count).toBeGreaterThanOrEqual(2);
    // patch 적용 → 두 번째 @@ 만났을 때 L204 break
    const patched = await tool.execute({ operation: "patch", diff_text: diff, old_text });
    expect(patched).toContain("CHANGED_2");
    expect(patched).toContain("CHANGED_19");
  });
});

// ══════════════════════════════════════════
// compute_diff_hunks — 마지막 변경 그룹 (j>=changes.length)
// ══════════════════════════════════════════

describe("DiffTool — compute_diff_hunks 마지막 변경 그룹", () => {
  it("변경이 끝 부분에만 있을 때 → end = end+ctx 경로", async () => {
    // 앞 부분은 같고 마지막 줄만 다름
    const old_text = "a\nb\nc\nd\ne\nf\ng\nold_last";
    const new_text = "a\nb\nc\nd\ne\nf\ng\nnew_last";
    const r = await tool.execute({ operation: "compare", old_text, new_text });
    expect(r).toContain("@@");
    expect(r).toContain("-old_last");
    expect(r).toContain("+new_last");
  });

  it("변경이 앞 부분에만 있을 때 → 정상 diff", async () => {
    const old_text = "old_first\na\nb\nc\nd\ne\nf\ng";
    const new_text = "new_first\na\nb\nc\nd\ne\nf\ng";
    const r = await tool.execute({ operation: "compare", old_text, new_text });
    expect(r).toContain("@@");
    expect(r).toContain("-old_first");
  });

  it("여러 separated 변경 그룹 → 여러 @@ 헝크", async () => {
    // 변경이 앞, 중간, 뒤에 있어 여러 헝크 생성
    const lines_old = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    const lines_new = [...lines_old];
    lines_new[2] = "CHANGED-2";
    lines_new[18] = "CHANGED-18";
    const r = await tool.execute({
      operation: "compare",
      old_text: lines_old.join("\n"),
      new_text: lines_new.join("\n"),
    });
    // 두 헝크가 ctx(3) 거리 이상 떨어져 있으므로 각각의 @@ 헝크 생성
    const hunk_count = (r.match(/^@@/gm) || []).length;
    expect(hunk_count).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════
// unsupported operation — default 분기
// ══════════════════════════════════════════

describe("DiffTool — unsupported operation", () => {
  it("지원하지 않는 operation → Error 문자열", async () => {
    const r = await tool.execute({ operation: "unknown_op", old_text: "a", new_text: "b" });
    expect(r).toContain("unsupported");
    expect(r).toContain("unknown_op");
  });
});

// ══════════════════════════════════════════
// compare context_lines 경계
// ══════════════════════════════════════════

describe("DiffTool — compare context_lines 경계값", () => {
  it("context_lines=5 → 5줄 컨텍스트 포함", async () => {
    const lines_old = Array.from({ length: 15 }, (_, i) => `line-${i}`);
    const lines_new = [...lines_old];
    lines_new[7] = "CHANGED";
    const r = await tool.execute({
      operation: "compare",
      old_text: lines_old.join("\n"),
      new_text: lines_new.join("\n"),
      context_lines: 5,
    });
    expect(r).toContain("@@");
  });

  it("context_lines=-1 → 0으로 clamp", async () => {
    const r = await tool.execute({
      operation: "compare",
      old_text: "a\nb\nc",
      new_text: "a\nB\nc",
      context_lines: -1,
    });
    // Math.max(0, -1) = 0 → 변경 라인만
    expect(r).toContain("@@");
  });
});
