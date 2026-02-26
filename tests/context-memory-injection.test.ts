import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ContextBuilder } from "../src/agent/context.ts";
import { MemoryStore } from "../src/agent/memory.ts";

test("system prompt does not inject recent daily memory into normal request", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "context-memory-"));
  try {
    const memory = new MemoryStore(workspace);
    await memory.write_longterm("# MEMORY\n\n- 장기 원칙: 정확성 우선\n");
    await memory.write_daily("# 2026-02-26 Memory\n\n- Spotify 스킬 fallback 추가했습니다.\n", "2026-02-26");

    const builder = new ContextBuilder(workspace, { memory_store: memory });
    const messages = await builder.build_messages([], "package.json 확인해줘");
    const system = messages.find((row) => row.role === "system");
    const content = String(system?.content || "");
    assert.equal(content.includes("## Recent Daily"), false);
    assert.equal(content.includes("Spotify 스킬"), false);
    assert.equal(content.includes("장기 원칙"), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
