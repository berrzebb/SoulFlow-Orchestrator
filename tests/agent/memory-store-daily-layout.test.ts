import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ContextBuilder } from "@src/agent/context.ts";
import { MemoryStore } from "@src/agent/memory.ts";

describe("memory store daily layout", () => {
  it("persists longterm and daily in memory.db", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memory-db-only-"));
    try {
      const store = new MemoryStore(workspace);
      await store.write_longterm("# MEMORY\n\n- 장기 원칙: 단순성\n");
      await store.write_daily("- 오늘 작업: cron runtime 개선\n", "2026-02-26");

      const memory_dir = join(workspace, "memory");
      const files = await readdir(memory_dir);
      expect(files.includes("memory.db")).toBe(true);
      expect(files.includes("MEMORY.md")).toBe(false);

      const longterm = await store.read_longterm();
      const daily = await store.read_daily("2026-02-26");
      expect(longterm.includes("장기 원칙")).toBe(true);
      expect(daily.includes("cron runtime 개선")).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("explicit yyyy-mm-dd context is loaded from memory.db", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memory-db-context-"));
    try {
      const store = new MemoryStore(workspace);
      await store.write_longterm("# MEMORY\n\n- 장기 원칙: 정확성 우선\n");
      await store.write_daily("- daily execution note\n", "2026-02-26");

      const builder = new ContextBuilder(workspace, { memory_store: store });
      const messages = await builder.build_messages(["2026-02-26"], "이어서 진행");
      const merged = messages
        .filter((row) => row.role === "system")
        .map((row) => String(row.content || ""))
        .join("\n\n");

      expect(merged.includes("## Longterm")).toBe(true);
      expect(merged.includes("Daily Memory Context")).toBe(true);
      expect(merged.includes("daily execution note")).toBe(true);
      expect(merged.includes("source: memory.db")).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("memory search uses sqlite fts document path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memory-db-fts-"));
    try {
      const store = new MemoryStore(workspace);
      await store.write_longterm("# MEMORY\n\n- 장기 규칙: sqlite fts5 우선\n");
      const rows = await store.search("sqlite fts5", { kind: "longterm", limit: 10 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.file === "longterm/MEMORY")).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("consolidate archive removes used daily rows", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "memory-db-archive-"));
    // 오늘 기준 동적 날짜 사용 (window 내 포함 보장)
    const today = new Date();
    const d1 = new Date(today); d1.setUTCDate(today.getUTCDate() - 2);
    const d2 = new Date(today); d2.setUTCDate(today.getUTCDate() - 1);
    const key1 = d1.toISOString().slice(0, 10);
    const key2 = d2.toISOString().slice(0, 10);
    try {
      const store = new MemoryStore(workspace);
      await store.write_daily("- daily 1\n", key1);
      await store.write_daily("- daily 2\n", key2);
      const result = await store.consolidate({ memory_window: 10, archive: true });
      expect(result.ok).toBe(true);
      expect(result.daily_entries_used.length).toBeGreaterThanOrEqual(1);
      const remains = await store.read_daily(key2);
      expect(remains.trim()).toBe("");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
