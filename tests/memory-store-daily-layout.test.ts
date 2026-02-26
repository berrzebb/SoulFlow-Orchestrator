import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextBuilder } from "../src/agent/context.ts";
import { MemoryStore } from "../src/agent/memory.ts";

test("memory store persists longterm and daily in memory.db", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "memory-db-only-"));
  try {
    const store = new MemoryStore(workspace);
    await store.write_longterm("# MEMORY\n\n- 장기 원칙: 단순성\n");
    await store.write_daily("- 오늘 작업: cron runtime 개선\n", "2026-02-26");

    const memory_dir = join(workspace, "memory");
    const files = await readdir(memory_dir);
    assert.equal(files.includes("memory.db"), true);
    assert.equal(files.includes("MEMORY.md"), false);

    const longterm = await store.read_longterm();
    const daily = await store.read_daily("2026-02-26");
    assert.equal(longterm.includes("장기 원칙"), true);
    assert.equal(daily.includes("cron runtime 개선"), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("explicit yyyy-mm-dd context is loaded from memory.db", async () => {
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

    assert.equal(merged.includes("## Longterm"), true);
    assert.equal(merged.includes("Daily Memory Context"), true);
    assert.equal(merged.includes("daily execution note"), true);
    assert.equal(merged.includes("source: memory.db"), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("memory search uses sqlite fts document path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "memory-db-fts-"));
  try {
    const store = new MemoryStore(workspace);
    await store.write_longterm("# MEMORY\n\n- 장기 규칙: sqlite fts5 우선\n");
    const rows = await store.search("sqlite fts5", { kind: "longterm", limit: 10 });
    assert.equal(rows.length > 0, true);
    assert.equal(rows.some((row) => row.file === "sqlite://memory/longterm"), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("consolidate archive removes used daily rows", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "memory-db-archive-"));
  try {
    const store = new MemoryStore(workspace);
    await store.write_daily("- daily 1\n", "2026-02-25");
    await store.write_daily("- daily 2\n", "2026-02-26");
    const result = await store.consolidate({ memory_window: 10, archive: true });
    assert.equal(result.ok, true);
    assert.equal(result.daily_files_used.length >= 1, true);
    const remains = await store.read_daily("2026-02-26");
    assert.equal(remains.trim(), "");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
