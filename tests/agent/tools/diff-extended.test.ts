/**
 * DiffTool — 미커버 분기 보충.
 * apply_patch (텍스트/파일), @file: resolve, text too large,
 * lcs_indices_greedy (>5000라인), compare context_lines,
 * patch에 target_path 미지정.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { DiffTool } from "@src/agent/tools/diff.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const tool = new DiffTool();

// ══════════════════════════════════════════
// apply_patch — 기본 텍스트 패치
// ══════════════════════════════════════════

describe("DiffTool — apply_patch: 텍스트 패치", () => {
  it("diff_text 없음 → Error", async () => {
    const r = await tool.execute({ operation: "patch", diff_text: "   ", old_text: "hello" });
    expect(r).toContain("Error");
    expect(r).toContain("diff_text");
  });

  it("old_text로 패치 → 새 텍스트 반환", async () => {
    // compare로 diff 생성 후 patch에 활용
    const old_text = "line1\nline2\nline3";
    const new_text = "line1\nMODIFIED\nline3";

    const diff = await tool.execute({ operation: "compare", old_text, new_text });
    expect(diff).toContain("@@");

    const patched = await tool.execute({ operation: "patch", diff_text: diff, old_text });
    // 패치 적용 결과에 MODIFIED가 포함되어야 함
    expect(patched).toContain("MODIFIED");
  });

  it("삭제 + 추가 혼합 패치", async () => {
    const old_text = "a\nb\nc\nd";
    const new_text = "a\nc\nd\ne";
    const diff = await tool.execute({ operation: "compare", old_text, new_text });
    const patched = await tool.execute({ operation: "patch", diff_text: diff, old_text });
    expect(patched).toContain("e");
    expect(patched).not.toContain("b");
  });
});

// ══════════════════════════════════════════
// apply_patch — 파일 대상 패치
// ══════════════════════════════════════════

describe("DiffTool — apply_patch: 파일 패치", () => {
  let tmp_file: string;

  afterEach(async () => {
    if (tmp_file) {
      await fs.unlink(tmp_file).catch(() => {});
    }
  });

  it("target_path로 파일에 직접 패치 → 성공 메시지", async () => {
    tmp_file = path.join(os.tmpdir(), `diff-test-${Date.now()}.txt`);
    const original = "alpha\nbeta\ngamma";
    await fs.writeFile(tmp_file, original, "utf-8");

    const old_text = original;
    const new_text = "alpha\nBETA\ngamma";
    const diff = await tool.execute({ operation: "compare", old_text, new_text });

    const r = await tool.execute({ operation: "patch", diff_text: diff, target: tmp_file });
    expect(r).toContain("Patched");
    expect(r).toContain(tmp_file);

    // 파일 내용 확인
    const content = await fs.readFile(tmp_file, "utf-8");
    expect(content).toContain("BETA");
  });
});

// ══════════════════════════════════════════
// resolve_text — @file: 경로
// ══════════════════════════════════════════

describe("DiffTool — @file: resolve", () => {
  let tmp_file: string;

  afterEach(async () => {
    if (tmp_file) {
      await fs.unlink(tmp_file).catch(() => {});
    }
  });

  it("@file: 접두사 → 파일 내용 읽기 후 compare", async () => {
    tmp_file = path.join(os.tmpdir(), `diff-read-${Date.now()}.txt`);
    await fs.writeFile(tmp_file, "file content line1\nfile content line2", "utf-8");

    const r = await tool.execute({
      operation: "compare",
      old_text: `@file:${tmp_file}`,
      new_text: "file content line1\nfile content CHANGED",
    });
    // 파일에서 읽어 비교, diff 결과에 --- a 포함
    expect(r).toContain("--- a");
  });

  it("@file: 없는 파일 → Error", async () => {
    const r = await tool.execute({
      operation: "compare",
      old_text: "@file:/nonexistent/file/path.txt",
      new_text: "something",
    });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// compare — context_lines 옵션
// ══════════════════════════════════════════

describe("DiffTool — compare: context_lines", () => {
  it("context_lines=0 → 변경 라인만 출력", async () => {
    const old_text = "a\nb\nc\nd\ne";
    const new_text = "a\nb\nX\nd\ne";
    const r = await tool.execute({ operation: "compare", old_text, new_text, context_lines: 0 });
    expect(r).toContain("@@");
    expect(r).toContain("-c");
    expect(r).toContain("+X");
  });

  it("context_lines=25 → 20으로 clamp", async () => {
    // 25 > 20 이므로 20으로 제한됨. 실행 자체는 성공해야 함
    const r = await tool.execute({
      operation: "compare",
      old_text: "a\nb",
      new_text: "a\nB",
      context_lines: 25,
    });
    expect(r).toBeTruthy();
  });
});

// ══════════════════════════════════════════
// lcs_indices_greedy — >5000 라인
// ══════════════════════════════════════════

describe("DiffTool — lcs_indices_greedy (대용량)", () => {
  it("5001줄 입력 → greedy 알고리즘 사용, stats 반환", async () => {
    const lines = Array.from({ length: 5001 }, (_, i) => `line-${i}`);
    const old_text = lines.join("\n");
    // 중간 10개 라인 변경
    const new_lines = [...lines];
    for (let i = 2500; i < 2510; i++) { new_lines[i] = `changed-${i}`; }
    const new_text = new_lines.join("\n");

    const r = await tool.execute({ operation: "stats", old_text, new_text });
    const parsed = JSON.parse(r);
    expect(parsed.old_lines).toBe(5001);
    expect(parsed.removed).toBeGreaterThan(0);
  }, 30_000);
});

// ══════════════════════════════════════════
// stats — 기본 검증
// ══════════════════════════════════════════

describe("DiffTool — stats 확장", () => {
  it("완전 동일 → changed=0, similarity=100%", async () => {
    const r = JSON.parse(await tool.execute({ operation: "stats", old_text: "a\nb\nc", new_text: "a\nb\nc" }));
    expect(r.changed).toBe(0);
    expect(r.similarity).toBe("100%");
  });

  it("완전 다름 → similarity=0%", async () => {
    const r = JSON.parse(await tool.execute({ operation: "stats", old_text: "a\nb\nc", new_text: "x\ny\nz" }));
    expect(r.similarity).toBe("0%");
  });

  it("old_text=빈문자열 → 줄 수 1, added 계산", async () => {
    // "".split("\n") = [""] → old_lines.length=1, similarity=0%
    const r = JSON.parse(await tool.execute({ operation: "stats", old_text: "", new_text: "a\nb" }));
    expect(r.old_lines).toBe(1);
    expect(r.new_lines).toBe(2);
    expect(typeof r.similarity).toBe("string");
  });
});

// ══════════════════════════════════════════
// L164: lcs_indices_greedy — else b_map.set (첫 번째 고유 라인)
// ══════════════════════════════════════════

describe("DiffTool — L164: lcs_indices_greedy else 분기 (5001+ 라인)", () => {
  it("5001개 라인 텍스트 비교 → greedy 경로 → L164 else b_map.set 실행", async () => {
    const lines_a = Array.from({ length: 5001 }, (_, i) => `line_${i}`);
    const lines_b = Array.from({ length: 5001 }, (_, i) =>
      i === 2500 ? `line_modified_${i}` : `line_${i}`,
    );

    const old_text = lines_a.join("\n");
    const new_text = lines_b.join("\n");

    const r = await tool.execute({ operation: "compare", old_text, new_text });

    expect(r).toContain("---");
    expect(r).toContain("+++");
    expect(r).toContain("line_modified_2500");
  }, 30000);
});

// ══════════════════════════════════════════
// L164: lcs_indices_greedy — if (arr) arr.push(idx) (중복 라인)
// ══════════════════════════════════════════

describe("DiffTool — L164: arr.push(idx) (중복 라인, greedy 경로)", () => {
  it("b 배열에 중복 라인 포함 → greedy에서 arr.push(idx) (L164 if 분기) 실행", async () => {
    const lines_a = Array.from({ length: 5001 }, (_, i) => `aline_${i}`);
    const lines_b: string[] = ["dup", "dup", ...Array.from({ length: 4999 }, (_, i) => `bline_${i}`)];

    const r = await tool.execute({
      operation: "compare",
      old_text: lines_a.join("\n"),
      new_text: lines_b.join("\n"),
    });

    expect(r).toContain("---");
    expect(r).toContain("+++");
  }, 30000);
});
