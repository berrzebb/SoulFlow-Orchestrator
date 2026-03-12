/**
 * ContextBuilder — 미커버 분기 보충 (cov4):
 * - Bug C-15: set_longterm_injection() — longterm 주입 최대 글자 수 제한
 *   → max > 0이고 longterm이 max보다 길면 slice(-max)로 tail 주입
 *   → max = 0이면 무제한
 * - Bug C-14b: filter_lines_by_scope — scope 없는 `- ` 라인은 모든 세션에 포함
 *   → `- [scope]` 형식이 아닌 일반 목록 항목은 scope 필터 통과
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextBuilder } from "@src/agent/context.service.js";
import { MemoryStore } from "@src/agent/memory.service.js";

async function make_ws() {
  return mkdtemp(join(tmpdir(), "ctx-cov4-"));
}

describe("set_longterm_injection() — longterm 주입 크기 제한 (C-15)", () => {
  it("max_chars > 0이면 longterm의 마지막 max_chars만 주입된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      const head = "A".repeat(500);
      const tail = "B".repeat(500);
      await memory.write_longterm(`${head}\n${tail}`);

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_longterm_injection(600); // head는 잘림, tail 보존

      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("B".repeat(100)); // tail 포함
      expect(prompt).not.toContain("A".repeat(500)); // head 제외 (잘림)
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("max_chars = 0이면 longterm 전체가 주입된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      const content = "X".repeat(30_000);
      await memory.write_longterm(content);

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_longterm_injection(0); // 무제한

      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("X".repeat(100));
      // 전체 길이 확인 — 30000자 모두 포함
      const count = (prompt.match(/X/g) || []).length;
      expect(count).toBe(30_000);
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("longterm이 max_chars 이하면 전체 주입된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      await memory.write_longterm("짧은 내용");

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_longterm_injection(20_000);

      const prompt = await builder.build_system_prompt();
      expect(prompt).toContain("짧은 내용");
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

describe("filter_lines_by_scope — scope 없는 일반 목록 항목 (C-14b)", () => {
  it("- [scope] 형식이 아닌 일반 - 항목은 scope 필터 후에도 포함된다", async () => {
    const ws = await make_ws();
    try {
      const memory = new MemoryStore(ws);
      await memory.write_daily(
        [
          "- [slack:ch1:main] USER(u1): 채널1 메시지",
          "- [slack:ch2:main] USER(u2): 채널2 메시지",
          "- 스코프 없는 공통 메모",
          "- 또 다른 일반 항목",
        ].join("\n"),
      );

      const builder = new ContextBuilder(ws, { memory_store: memory });
      builder.set_daily_injection(1);

      const prompt = await builder.build_system_prompt([], undefined, {
        channel: "slack",
        chat_id: "ch1",
      });

      expect(prompt).toContain("채널1 메시지");      // scope 일치 → 포함
      expect(prompt).not.toContain("채널2 메시지");  // scope 불일치 → 제외
      expect(prompt).toContain("스코프 없는 공통 메모"); // 일반 항목 → 포함
      expect(prompt).toContain("또 다른 일반 항목");     // 일반 항목 → 포함
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
