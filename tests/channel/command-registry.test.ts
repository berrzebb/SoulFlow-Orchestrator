import { describe, it, expect, vi, beforeEach } from "vitest";
import { get_command_descriptors, format_help_text } from "@src/channels/commands/registry.js";

describe("CommandDescriptor registry", () => {
  it("returns all command descriptors", () => {
    const descriptors = get_command_descriptors();
    expect(descriptors).toHaveLength(16);
    const names = descriptors.map((d) => d.name);
    expect(names).toEqual([
      "help", "stop", "render", "secret", "memory",
      "decision", "promise", "cron", "reload", "task", "status",
      "skill", "doctor", "agent", "stats", "verify",
    ]);
  });

  it("every descriptor has name and description", () => {
    for (const d of get_command_descriptors()) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
    }
  });

  it("returns a new array each call (immutable)", () => {
    const a = get_command_descriptors();
    const b = get_command_descriptors();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("format_help_text", () => {
  it("includes header and all command names", () => {
    const text = format_help_text(get_command_descriptors());
    expect(text).toContain("사용 가능한 공통 명령");
    expect(text).toContain("/help");
    expect(text).toContain("/secret");
    expect(text).toContain("/cron");
    expect(text).toContain("/reload");
  });

  it("appends usage when present", () => {
    const text = format_help_text([
      { name: "test", description: "테스트", usage: "<arg1> <arg2>" },
    ]);
    expect(text).toContain("- /test <arg1> <arg2>");
  });

  it("omits usage when empty", () => {
    const text = format_help_text([
      { name: "ping", description: "핑", usage: "" },
    ]);
    expect(text).toContain("- /ping");
    expect(text).not.toContain("- /ping ");
  });
});

describe("TelegramChannel.sync_commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls setMyCommands with mapped descriptors", async () => {
    const { TelegramChannel } = await import("@src/channels/telegram.channel.js");
    const channel = new TelegramChannel({
      bot_token: "test-token",
      api_base: "https://mock.telegram.api",
    });

    let captured_body: unknown = null;
    const mock_fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (String(url).includes("setMyCommands")) {
        captured_body = JSON.parse(String(init.body));
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", mock_fetch);

    const descriptors = [
      { name: "help", description: "도움말", usage: "" },
      { name: "secret", description: "시크릿 관리", usage: "status|list" },
    ];

    await channel.sync_commands(descriptors);

    expect(mock_fetch).toHaveBeenCalledTimes(1);
    expect(String(mock_fetch.mock.calls[0][0])).toContain("/setMyCommands");
    expect(captured_body).toEqual({
      commands: [
        { command: "help", description: "도움말" },
        { command: "secret", description: "시크릿 관리" },
      ],
    });
  });

  it("does nothing when bot_token is empty", async () => {
    const { TelegramChannel } = await import("@src/channels/telegram.channel.js");
    const channel = new TelegramChannel({ bot_token: "" });
    const mock_fetch = vi.fn();
    vi.stubGlobal("fetch", mock_fetch);

    await channel.sync_commands(get_command_descriptors());
    expect(mock_fetch).not.toHaveBeenCalled();
  });

  it("records error on API failure without throwing", async () => {
    const { TelegramChannel } = await import("@src/channels/telegram.channel.js");
    const channel = new TelegramChannel({
      bot_token: "test-token",
      api_base: "https://mock.telegram.api",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    }));

    await channel.sync_commands(get_command_descriptors());
    const health = channel.get_health();
    expect(health.last_error).toContain("Unauthorized");
  });
});

describe("BaseChannel.sync_commands (no-op)", () => {
  it("slack and discord channels have no-op sync_commands", async () => {
    const { SlackChannel } = await import("@src/channels/slack.channel.js");
    const { DiscordChannel } = await import("@src/channels/discord.channel.js");

    const slack = new SlackChannel({ bot_token: "xoxb-test" });
    const discord = new DiscordChannel({ bot_token: "test" });

    // no-op: should resolve without error
    await slack.sync_commands(get_command_descriptors());
    await discord.sync_commands(get_command_descriptors());
  });
});
