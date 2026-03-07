import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ContextBuilder } from "@src/agent/context.ts";
import { MemoryStore } from "@src/agent/memory.ts";

describe("context memory injection", () => {
  it("system prompt injects recent daily memory alongside longterm memory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "context-memory-"));
    try {
      const memory = new MemoryStore(workspace);
      await memory.write_longterm("# MEMORY\n\n- 장기 원칙: 정확성 우선\n");
      await memory.write_daily("# 2026-02-26 Memory\n\n- Spotify 스킬 fallback 추가했습니다.\n", "2026-02-26");

      const builder = new ContextBuilder(workspace, { memory_store: memory });
      const messages = await builder.build_messages([], "package.json 확인해줘");
      const system = messages.find((row) => row.role === "system");
      const content = String(system?.content || "");
      expect(content.includes("장기 원칙")).toBe(true);
      // daily_injection_days=1 이므로 최근 daily가 포함됨
      expect(content.includes("## Recent Daily")).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
