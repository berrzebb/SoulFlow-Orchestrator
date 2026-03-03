import { describe, it, expect } from "vitest";
import type { CommandContext, CommandHandler } from "@src/channels/commands/types.ts";
import { create_harness, inbound } from "@helpers/harness.ts";

class FakeSecretHandler implements CommandHandler {
  readonly name = "secret";

  can_handle(ctx: CommandContext): boolean {
    return ctx.text.toLowerCase().includes("/secret");
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const text = ctx.text.toLowerCase();
    if (text.includes("status")) {
      await ctx.send_reply("secret vault 상태\n- keys: 0");
      return true;
    }
    if (text.includes("set")) {
      await ctx.send_reply("secret 저장 완료");
      return true;
    }
    if (text.includes("get")) {
      await ctx.send_reply("ciphertext: sv1.xxx.yyy.zzz");
      return true;
    }
    if (text.includes("encrypt")) {
      await ctx.send_reply("encrypt 완료\nciphertext: sv1.xxx.yyy.zzz");
      return true;
    }
    await ctx.send_reply("secret 명령 사용법\n- /secret status | set | get | encrypt | decrypt");
    return true;
  }
}

describe("secret slash aliases", () => {
  it("are handled by command router without orchestration", async () => {
    let orchestration_calls = 0;
    const harness = await create_harness({
      command_handlers: [new FakeSecretHandler()],
      orchestration_handler: async () => {
        orchestration_calls += 1;
        return { reply: "agent-called", mode: "once", tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await harness.manager.handle_inbound_message(inbound("/secret-status"));
      await harness.manager.handle_inbound_message(inbound("/secret-set api_token abc123"));
      await harness.manager.handle_inbound_message(inbound("/secret-get api_token"));
      await harness.manager.handle_inbound_message(inbound("/secret-encrypt hello"));
      await harness.manager.handle_inbound_message(inbound("/secret-decrypt"));

      expect(orchestration_calls).toBe(0);
      const contents = harness.registry.sent.map((m) => String(m.content || ""));
      expect(contents.some((c) => /secret vault 상태/i.test(c))).toBe(true);
      expect(contents.some((c) => /secret 저장 완료/i.test(c))).toBe(true);
      expect(contents.some((c) => /ciphertext/i.test(c))).toBe(true);
      expect(contents.some((c) => /encrypt 완료/i.test(c))).toBe(true);
      expect(contents.some((c) => /secret 명령 사용법/i.test(c))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });
});
