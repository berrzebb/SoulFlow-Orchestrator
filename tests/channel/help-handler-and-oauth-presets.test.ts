/**
 * HelpHandler, oauth/presets — 미커버 모듈 테스트.
 */
import { describe, it, expect } from "vitest";
import { HelpHandler } from "@src/channels/commands/help.handler.js";
import { register_preset, unregister_preset, get_preset, list_presets } from "@src/oauth/presets.js";
import type { OAuthServicePreset } from "@src/oauth/presets.js";

// ══════════════════════════════════════════
// HelpHandler
// ══════════════════════════════════════════

function make_help_ctx(opts: { command_name?: string; provider?: string } = {}): any {
  const { command_name = "help", provider = "telegram" } = opts;
  const replies: string[] = [];
  return {
    provider: provider as any,
    message: { sender_id: "u1", content: "", chat_id: "c1", message_id: "m1", provider } as any,
    command: { name: command_name, raw: `/${command_name}`, args: [], args_lower: [] },
    text: `/${command_name}`,
    send_reply: async (msg: string) => { replies.push(msg); },
    replies,
  };
}

describe("HelpHandler — can_handle", () => {
  const h = new HelpHandler();

  it("'help' → true", () => expect(h.can_handle(make_help_ctx({ command_name: "help" }))).toBe(true));
  it("'commands' → true", () => expect(h.can_handle(make_help_ctx({ command_name: "commands" }))).toBe(true));
  it("'cmd' → true", () => expect(h.can_handle(make_help_ctx({ command_name: "cmd" }))).toBe(true));
  it("'도움말' → true", () => expect(h.can_handle(make_help_ctx({ command_name: "도움말" }))).toBe(true));
  it("'unknown' → false", () => expect(h.can_handle(make_help_ctx({ command_name: "unknown" }))).toBe(false));
  it("command=null → false", () => {
    const ctx = { ...make_help_ctx(), command: null };
    expect(h.can_handle(ctx)).toBe(false);
  });
});

describe("HelpHandler — handle", () => {
  it("help 메시지 반환 (telegram → mention 없음)", async () => {
    const h = new HelpHandler();
    const ctx = make_help_ctx({ command_name: "help", provider: "telegram" });
    const result = await h.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies.length).toBe(1);
    expect(ctx.replies[0]).toBeTruthy();
  });

  it("slack provider → @sender mention 포함", async () => {
    const h = new HelpHandler();
    const ctx = make_help_ctx({ command_name: "help", provider: "slack" });
    const result = await h.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("@u1");
  });
});

// ══════════════════════════════════════════
// oauth/presets.ts
// ══════════════════════════════════════════

const TEST_PRESET: OAuthServicePreset = {
  service_type: "test-svc-unique",
  label: "Test Service",
  auth_url: "https://test.example.com/auth",
  token_url: "https://test.example.com/token",
  scopes_available: ["read", "write"],
  default_scopes: ["read"],
  supports_refresh: true,
  is_builtin: false,
};

describe("oauth/presets", () => {
  it("register_preset + get_preset → 조회 성공", () => {
    register_preset(TEST_PRESET);
    const found = get_preset("test-svc-unique");
    expect(found).toMatchObject({ service_type: "test-svc-unique", label: "Test Service" });
  });

  it("list_presets → 등록된 프리셋 + custom 포함", () => {
    register_preset(TEST_PRESET);
    const list = list_presets();
    expect(list.some(p => p.service_type === "test-svc-unique")).toBe(true);
    expect(list.some(p => p.service_type === "custom")).toBe(true);
  });

  it("unregister_preset → 삭제 성공", () => {
    register_preset(TEST_PRESET);
    const removed = unregister_preset("test-svc-unique");
    expect(removed).toBe(true);
    expect(get_preset("test-svc-unique")).toBeNull();
  });

  it("존재하지 않는 서비스 → get_preset null", () => {
    expect(get_preset("nonexistent-xyz")).toBeNull();
  });

  it("존재하지 않는 서비스 unregister → false", () => {
    expect(unregister_preset("nonexistent-xyz")).toBe(false);
  });
});
