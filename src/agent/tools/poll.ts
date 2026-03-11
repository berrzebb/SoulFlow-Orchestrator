/**
 * PollTool — 에이전트가 채널 투표/설문을 전송하는 도구.
 * Telegram: sendPoll API, Discord: Poll API v10.
 * Slack 등 미지원 채널은 텍스트 폴백으로 에뮬레이션.
 */

import { Tool } from "./base.js";
import type { JsonSchema, ToolCategory, ToolExecutionContext } from "./types.js";
import type { ChannelRegistryLike, SendPollRequest } from "../../channels/types.js";

export class PollTool extends Tool {
  readonly name = "poll";
  readonly category: ToolCategory = "messaging";
  readonly policy_flags = { write: true } as const;
  readonly description = "Send a poll/survey to a chat channel. Supports native polls on Telegram and Discord.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      question: { type: "string", description: "Poll question (max 300 chars)" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Poll options (2-10 items, each max 100 chars)",
      },
      allows_multiple_answers: { type: "boolean", description: "Allow multiple selections. Default false." },
      is_anonymous: { type: "boolean", description: "Anonymous voting. Default true." },
      open_period: { type: "integer", description: "Auto-close after N seconds (5-600 for Telegram, 3600-604800 for Discord)." },
      channel: { type: "string", description: "Target channel/provider instance ID" },
      chat_id: { type: "string", description: "Target chat ID" },
    },
    required: ["question", "options"],
    additionalProperties: false,
  };

  private readonly channels: ChannelRegistryLike;

  constructor(channels: ChannelRegistryLike) {
    super();
    this.channels = channels;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const question = String(params.question || "").trim();
    if (!question) return "Error: question is required";

    const raw_options = Array.isArray(params.options) ? params.options : [];
    const options = raw_options
      .map((o) => String(o || "").trim())
      .filter(Boolean)
      .map((text) => ({ text }));

    if (options.length < 2) return "Error: at least 2 options are required";
    if (options.length > 10) return "Error: maximum 10 options allowed";

    const channel_id = String(params.channel || context?.channel || "").trim();
    const chat_id = String(params.chat_id || context?.chat_id || "").trim();

    if (!channel_id) return "Error: channel is required";
    if (!chat_id) return "Error: chat_id is required";

    const channels_by_provider = this.channels.get_channels_by_provider(channel_id);
    const target_channel = this.channels.get_channel(channel_id) || channels_by_provider[0];
    if (!target_channel) return `Error: channel not found: ${channel_id}`;

    const poll: SendPollRequest = {
      chat_id,
      question,
      options,
      allows_multiple_answers: params.allows_multiple_answers === true,
      is_anonymous: params.is_anonymous !== false,
      open_period: typeof params.open_period === "number" ? params.open_period : undefined,
    };

    const result = await target_channel.send_poll(poll);
    if (!result.ok) return `Error: ${result.error || "poll_send_failed"}`;
    return `Poll sent: question="${question}" options=${options.length} message_id=${result.message_id || "unknown"}`;
  }
}
