/**
 * MemoryStore — consolidate() 빈 daily 엔트리 버그 수정 검증 (cov12):
 * - Bug C-16: daily 내용이 없을 때 consolidate()가 longterm에 빈 헤더를 append하던 문제
 *   → 수정 후: body가 없으면 append_longterm 호출하지 않음
 *   → longterm_appended_chars = 0, summary = "no daily entries consolidated"
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@src/agent/memory.service.js";

let tmp_dir: string;

afterEach(async () => {
  if (tmp_dir) await rm(tmp_dir, { recursive: true, force: true });
});

describe("consolidate() — empty body fix (C-16)", () => {
  it("daily 엔트리가 없으면 longterm에 아무것도 append하지 않는다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov12-"));
    const store = new MemoryStore(tmp_dir);

    await store.write_longterm("기존 longterm 내용");

    const result = await store.consolidate({ memory_window: 7 });

    expect(result.ok).toBe(true);
    expect(result.longterm_appended_chars).toBe(0);
    expect(result.daily_entries_used).toHaveLength(0);
    expect(result.summary).toBe("no daily entries consolidated");

    // longterm 내용이 변하지 않았는지 확인
    const lt = await store.read_longterm();
    expect(lt.trim()).toBe("기존 longterm 내용");
  });

  it("window 범위 밖 daily만 있으면 longterm에 append하지 않는다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov12b-"));
    const store = new MemoryStore(tmp_dir);

    // 100일 전 daily — window_days=7 범위 밖
    await store.write_daily("오래된 내용", "2025-11-01");
    await store.write_longterm("기존 장기 메모리");

    const result = await store.consolidate({ memory_window: 7 });

    expect(result.longterm_appended_chars).toBe(0);
    expect(result.daily_entries_used).toHaveLength(0);

    const lt = await store.read_longterm();
    expect(lt.trim()).toBe("기존 장기 메모리");
  });

  it("window 범위 내 daily가 있으면 정상 append한다", async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "mem-cov12c-"));
    const store = new MemoryStore(tmp_dir);

    const today = new Date().toISOString().slice(0, 10);
    await store.write_daily("오늘 대화 기록", today);

    const result = await store.consolidate({ memory_window: 7 });

    expect(result.ok).toBe(true);
    expect(result.longterm_appended_chars).toBeGreaterThan(0);
    expect(result.daily_entries_used).toContain(today);
    expect(result.summary).toContain("1 daily entries");

    const lt = await store.read_longterm();
    expect(lt).toContain("오늘 대화 기록");
  });
});
