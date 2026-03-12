/**
 * MemoryTool — append_longterm/append_daily 줄 분리 버그 수정 검증 (C-19).
 *
 * Bug C-19: content를 .trim()하면 trailing '\n'이 제거됨
 *   → 연속 호출 시 entries가 separator 없이 붙어버림
 *   → 수정: 항상 content + '\n' 형식으로 append
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryTool } from "@src/agent/tools/memory-tool.js";
import { MemoryStore } from "@src/agent/memory.service.js";

let tmp_dir: string;

afterEach(async () => {
  if (tmp_dir) await rm(tmp_dir, { recursive: true, force: true });
});

describe("MemoryTool — append_longterm 줄 분리 (C-19)", () => {
  it("두 번 연속 append_longterm 시 개행으로 분리된다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mt-cov1-"));
    const store = new MemoryStore(tmp_dir);
    const tool = new MemoryTool(store);

    await tool["run"]({ action: "append_longterm", content: "첫 번째 항목" });
    await tool["run"]({ action: "append_longterm", content: "두 번째 항목" });

    const lt = await store.read_longterm();
    // 두 항목이 개행으로 분리되어야 함
    expect(lt).toContain("첫 번째 항목\n두 번째 항목");
    // 하나의 줄로 합쳐지지 않아야 함
    expect(lt).not.toContain("첫 번째 항목두 번째 항목");
  });

  it("빈 content는 에러를 반환한다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mt-cov1b-"));
    const store = new MemoryStore(tmp_dir);
    const tool = new MemoryTool(store);

    const result = await tool["run"]({ action: "append_longterm", content: "" });
    expect(result).toContain("Error");
  });
});

describe("MemoryTool — append_daily 줄 분리 (C-19)", () => {
  it("두 번 연속 append_daily 시 개행으로 분리된다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mt-cov1c-"));
    const store = new MemoryStore(tmp_dir);
    const tool = new MemoryTool(store);

    const today = new Date().toISOString().slice(0, 10);
    await tool["run"]({ action: "append_daily", content: "- 항목1", day: today });
    await tool["run"]({ action: "append_daily", content: "- 항목2", day: today });

    const daily = await store.read_daily(today);
    // 두 항목이 개행으로 분리되어야 함
    expect(daily).toContain("- 항목1\n- 항목2");
    // 하나의 줄로 합쳐지지 않아야 함
    expect(daily).not.toContain("- 항목1- 항목2");
  });

  it("append_daily: 빈 content는 에러를 반환한다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mt-cov1d-"));
    const store = new MemoryStore(tmp_dir);
    const tool = new MemoryTool(store);

    const result = await tool["run"]({ action: "append_daily", content: "  " });
    expect(result).toContain("Error");
  });
});
