import { describe, it, expect } from "vitest";
import type { CommandContext, CommandHandler } from "@src/channels/commands/types.ts";
import { create_harness, inbound } from "@helpers/harness.ts";

class FakeMemoryHandler implements CommandHandler {
  readonly name = "memory";
  can_handle(ctx: CommandContext): boolean {
    const cmd = ctx.command;
    if (cmd && cmd.name === "memory") return true;
    const text = ctx.text.toLowerCase();
    return text.includes("메모리") || text.includes("memory");
  }
  async handle(ctx: CommandContext): Promise<boolean> {
    await ctx.send_reply("메모리 상태\n- daily: 1건\n- 상태 점검 완료");
    return true;
  }
}

class FakeTaskHandler implements CommandHandler {
  readonly name = "task";
  can_handle(ctx: CommandContext): boolean {
    const cmd = ctx.command;
    return cmd?.name === "task";
  }
  async handle(ctx: CommandContext): Promise<boolean> {
    await ctx.send_reply("활성 작업: 0건");
    return true;
  }
}

class FakeDecisionHandler implements CommandHandler {
  readonly name = "decision";
  private readonly store = new Map<string, string>();

  can_handle(ctx: CommandContext): boolean {
    const text = ctx.text.toLowerCase();
    return text.includes("/decision") || text.includes("지침");
  }
  async handle(ctx: CommandContext): Promise<boolean> {
    const text = ctx.text;
    const set_match = text.match(/\/decision\s+set\s+(\S+)\s+(.+)/i);
    if (set_match) {
      this.store.set(set_match[1]!, set_match[2]!);
      await ctx.send_reply(`결정사항 저장 완료\n- key: ${set_match[1]}\n- value: ${set_match[2]}`);
      return true;
    }
    const entries = [...this.store.entries()].map(([k, v]) => `- ${k}: ${v}`).join("\n");
    await ctx.send_reply(`현재 지침/결정사항\n${entries || "- (empty)"}`);
    return true;
  }
}

describe("orchestrator direct commands", () => {
  it("memory status command is handled by command router without orchestration", async () => {
    let orchestration_calls = 0;
    const harness = await create_harness({
      command_handlers: [new FakeMemoryHandler()],
      orchestration_handler: async () => {
        orchestration_calls += 1;
        return { reply: "agent-called", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("@assistant 메모리 상태 확인"));
      expect(orchestration_calls).toBe(0);
      expect(harness.registry.sent.length).toBeGreaterThan(0);
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/메모리 상태/i);
    } finally {
      await harness.cleanup();
    }
  });

  it("decision set/status commands are handled by command router without orchestration", async () => {
    let orchestration_calls = 0;
    const harness = await create_harness({
      command_handlers: [new FakeDecisionHandler()],
      orchestration_handler: async () => {
        orchestration_calls += 1;
        return { reply: "agent-called", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("/decision set language 한국어 우선"));
      await harness.manager.handle_inbound_message(inbound("@assistant 현재 지침은?"));
      expect(orchestration_calls).toBe(0);
      expect(harness.registry.sent.length).toBeGreaterThanOrEqual(2);
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/language/i);
      expect(String(last.content || "")).toMatch(/한국어 우선/i);
    } finally {
      await harness.cleanup();
    }
  });

  it("builtin classification routes to command handler without agent spawn", async () => {
    const harness = await create_harness({
      command_handlers: [new FakeTaskHandler()],
      orchestration_handler: async () => ({
        reply: null, mode: "once" as const, tool_calls_count: 0, streamed: false,
        builtin_command: "task", builtin_args: "list",
      }),
    });
    try {
      await harness.manager.handle_inbound_message(inbound("작업 목록 보여줘"));
      const last = harness.registry.sent[harness.registry.sent.length - 1];
      expect(String(last.content || "")).toMatch(/활성 작업/i);
    } finally {
      await harness.cleanup();
    }
  });

  it("builtin fallback when command not found — no crash", async () => {
    const harness = await create_harness({
      orchestration_handler: async () => ({
        reply: null, mode: "once" as const, tool_calls_count: 0, streamed: false,
        builtin_command: "nonexistent", builtin_args: "test",
      }),
    });
    try {
      // 커맨드 매칭 실패 → 에러 없이 처리
      await harness.manager.handle_inbound_message(inbound("존재하지않는명령"));
    } finally {
      await harness.cleanup();
    }
  });
});
