import { describe, it, expect, vi, beforeEach } from "vitest";
import { SendFileTool } from "@src/agent/tools/send-file.js";
import type { OutboundMessage } from "@src/bus/types.js";

vi.mock("@src/agent/tools/media-utils.js", () => ({
  to_local_media_item: (value: string, _workspace: string) => {
    if (value.includes("missing") || value.includes("dir-only")) return null;
    const ext = value.split(".").pop() || "";
    const type_map: Record<string, string> = {
      pdf: "file", png: "image", jpg: "image", mp3: "audio", mp4: "video",
    };
    return {
      type: type_map[ext] || "file",
      url: `/workspace/${value}`,
      name: value.split("/").pop() || value,
    };
  },
}));

vi.mock("@src/security/secret-vault-factory.js", () => ({
  get_shared_secret_vault: () => ({
    resolve_inline_secrets_with_report: async (text: string) => ({
      text,
      missing_keys: [],
      invalid_ciphertexts: [],
    }),
  }),
}));

describe("SendFileTool", () => {
  let tool: SendFileTool;
  let sent: OutboundMessage[];
  const send_callback = async (msg: OutboundMessage) => { sent.push(msg); };

  beforeEach(() => {
    sent = [];
    tool = new SendFileTool({
      send_callback,
      workspace: "/workspace",
      default_channel: "slack",
      default_chat_id: "C123",
    });
  });

  it("sends a PDF file with caption", async () => {
    const result = await tool.execute({ file_path: "report.pdf", caption: "보고서입니다." });

    expect(result).toContain("file_sent");
    expect(result).toContain("report.pdf");
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe("보고서입니다.");
    expect(sent[0].media).toHaveLength(1);
    expect(sent[0].media![0].type).toBe("file");
    expect(sent[0].metadata?.kind).toBe("file_delivery");
  });

  it("uses filename as content when no caption provided", async () => {
    const result = await tool.execute({ file_path: "chart.png" });

    expect(result).toContain("file_sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe("chart.png");
    expect(sent[0].media![0].type).toBe("image");
  });

  it("returns error when file not found", async () => {
    const result = await tool.execute({ file_path: "missing.pdf" });

    expect(result).toContain("Error");
    expect(result).toContain("file not found");
    expect(sent).toHaveLength(0);
  });

  it("returns error when file_path is empty", async () => {
    const result = await tool.execute({ file_path: "" });

    expect(result).toContain("Error");
    expect(result).toContain("file_path is required");
    expect(sent).toHaveLength(0);
  });

  it("returns error when send_callback is not configured", async () => {
    const no_callback_tool = new SendFileTool({ workspace: "/workspace" });
    const result = await no_callback_tool.execute({ file_path: "report.pdf" });

    expect(result).toContain("Error");
    expect(result).toContain("send callback is not configured");
  });

  it("returns error when channel/chat_id are missing", async () => {
    const no_context_tool = new SendFileTool({ send_callback, workspace: "/workspace" });
    const result = await no_context_tool.execute({ file_path: "report.pdf" });

    expect(result).toContain("Error");
    expect(result).toContain("channel and chat_id are required");
  });

  it("uses context channel/chat_id over defaults", async () => {
    const result = await tool.execute(
      { file_path: "report.pdf" },
      { channel: "telegram", chat_id: "T456", sender_id: "user1" },
    );

    expect(result).toContain("file_sent");
    expect(sent[0].channel).toBe("telegram");
    expect(sent[0].chat_id).toBe("T456");
    expect(sent[0].sender_id).toBe("user1");
  });

  it("set_context updates defaults", async () => {
    tool.set_context("discord", "D789");
    await tool.execute({ file_path: "data.csv" });

    expect(sent[0].channel).toBe("discord");
    expect(sent[0].chat_id).toBe("D789");
  });

  it("set_send_callback replaces callback", async () => {
    const alt_sent: OutboundMessage[] = [];
    tool.set_send_callback(async (msg) => { alt_sent.push(msg); });
    await tool.execute({ file_path: "track.mp3" });

    expect(sent).toHaveLength(0);
    expect(alt_sent).toHaveLength(1);
    expect(alt_sent[0].media![0].type).toBe("audio");
  });

  it("detects media types correctly via mock", async () => {
    for (const [file, expected_type] of [
      ["photo.png", "image"],
      ["photo.jpg", "image"],
      ["video.mp4", "video"],
      ["audio.mp3", "audio"],
      ["doc.pdf", "file"],
      ["unknown.xyz", "file"],
    ] as const) {
      sent = [];
      await tool.execute({ file_path: file });
      expect(sent[0].media![0].type).toBe(expected_type);
    }
  });

  it("returns error for directory path", async () => {
    const result = await tool.execute({ file_path: "dir-only/" });

    expect(result).toContain("Error");
    expect(sent).toHaveLength(0);
  });
});
