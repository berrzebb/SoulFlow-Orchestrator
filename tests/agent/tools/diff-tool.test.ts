/**
 * DiffTool — compare/stats 테스트 (파일 I/O 없는 순수 텍스트).
 */
import { describe, it, expect } from "vitest";
import { DiffTool } from "../../../src/agent/tools/diff.js";

describe("DiffTool", () => {
  const tool = new DiffTool();

  it("metadata: name=diff, category=memory", () => {
    expect(tool.name).toBe("diff");
    expect(tool.category).toBe("memory");
  });

  it("compare: 동일 텍스트 → no differences", async () => {
    const result = await tool.execute({
      operation: "compare",
      old_text: "hello world",
      new_text: "hello world",
    });
    expect(result).toContain("no differences");
  });

  it("compare: 다른 텍스트 → unified diff 생성", async () => {
    const result = await tool.execute({
      operation: "compare",
      old_text: "line1\nline2\nline3",
      new_text: "line1\nmodified\nline3",
    });
    expect(result).toContain("--- a");
    expect(result).toContain("+++ b");
  });

  it("stats: 변경 통계 반환", async () => {
    const result = await tool.execute({
      operation: "stats",
      old_text: "a\nb\nc",
      new_text: "a\nB\nc\nd",
    });
    expect(result).toBeTruthy();
  });

  it("unsupported operation → 에러", async () => {
    const result = await tool.execute({ operation: "invalid" });
    expect(result).toContain("unsupported");
  });
});
