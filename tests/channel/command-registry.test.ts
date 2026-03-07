import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import {
  get_command_descriptors,
  get_command_descriptor,
  format_help_text,
  format_subcommand_usage,
  format_subcommand_guide,
} from "@src/channels/commands/registry.js";
import { set_locale } from "@src/i18n/index.js";

beforeAll(() => set_locale("ko"));

describe("CommandDescriptor registry", () => {
  it("returns all command descriptors", () => {
    const descriptors = get_command_descriptors();
    expect(descriptors).toHaveLength(21);
    const names = descriptors.map((d) => d.name);
    expect(names).toEqual([
      "help", "stop", "render", "secret", "memory",
      "decision", "promise", "cron", "reload", "task", "status",
      "skill", "doctor", "agent", "stats", "verify", "guard",
      "workflow", "model", "mcp", "tone",
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

  it("shows description without usage when no subcommands", () => {
    const text = format_help_text([
      { name: "ping", description: "핑" },
    ]);
    expect(text).toContain("- /ping");
    expect(text).toContain("핑");
  });

  it("shows subcommand count for commands with subcommands", () => {
    const text = format_help_text([
      { name: "task", description: "작업 관리", subcommands: [
        { name: "list", description: "목록" },
        { name: "cancel", description: "취소" },
      ]},
    ]);
    expect(text).toContain("세부 기능 2개");
  });
});

describe("get_command_descriptor", () => {
  it("존재하는 커맨드 반환", () => {
    const desc = get_command_descriptor("task");
    expect(desc).not.toBeNull();
    expect(desc!.name).toBe("task");
    expect(desc!.subcommands).toBeDefined();
    expect(desc!.subcommands!.length).toBeGreaterThan(0);
  });

  it("없는 커맨드 → null", () => {
    expect(get_command_descriptor("nonexistent")).toBeNull();
  });
});

describe("format_subcommand_usage", () => {
  it("존재하는 서브커맨드 사용법 반환", () => {
    const text = format_subcommand_usage("task", "cancel");
    expect(text).toContain("/task cancel");
    expect(text).toContain("<id|all>");
  });

  it("없는 서브커맨드 → 기본 포맷", () => {
    const text = format_subcommand_usage("task", "nonexistent");
    expect(text).toBe("/task nonexistent");
  });
});

describe("format_subcommand_guide", () => {
  it("서브커맨드가 있는 명령 → 가이드 텍스트", () => {
    const guide = format_subcommand_guide("task");
    expect(guide).not.toBeNull();
    expect(guide).toContain("/task list");
    expect(guide).toContain("/task cancel");
    expect(guide).toContain("/task status");
  });

  it("서브커맨드 없는 명령 → null", () => {
    expect(format_subcommand_guide("help")).toBeNull();
  });

  it("없는 명령 → null", () => {
    expect(format_subcommand_guide("nonexistent")).toBeNull();
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
