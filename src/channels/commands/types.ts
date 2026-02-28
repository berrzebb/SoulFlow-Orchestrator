import type { InboundMessage } from "../../bus/types.js";
import type { ChannelProvider } from "../types.js";
import type { ParsedSlashCommand } from "../slash-command.js";

export type CommandContext = {
  provider: ChannelProvider;
  message: InboundMessage;
  command: ParsedSlashCommand | null;
  text: string;
  send_reply: (content: string) => Promise<void>;
};

/** Telegram은 @멘션 불필요, 나머지 채널은 @sender 접두어 사용. */
export function format_mention(provider: ChannelProvider, sender_id: string): string {
  return provider === "telegram" ? "" : `@${sender_id} `;
}

/** 단일 커맨드 도메인을 처리하는 핸들러. */
export interface CommandHandler {
  readonly name: string;
  can_handle(ctx: CommandContext): boolean;
  handle(ctx: CommandContext): Promise<boolean>;
}
