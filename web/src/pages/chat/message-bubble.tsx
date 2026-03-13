import { useT } from "../../i18n";
import { MessageBubble } from "../../components/message-bubble";
import { MediaDisplay } from "./media-preview";
import { ThinkingBlockList } from "./tool-call-block";
import type { ChatMessage } from "./types";
import type { ThinkingEntry } from "../../hooks/use-ndjson-stream";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  streaming?: boolean;
  /** 스트리밍 중 실시간 thinking 블록 — 없으면 message.thinking_blocks 사용 */
  thinking_blocks?: ThinkingEntry[];
}

export function ChatMessageBubble({ message, streaming, thinking_blocks }: ChatMessageBubbleProps) {
  const t = useT();
  const is_user = message.direction === "user";
  const blocks = thinking_blocks ?? message.thinking_blocks;

  return (
    <MessageBubble
      role={is_user ? "user" : "assistant"}
      content={message.content ?? ""}
      at={message.at}
      avatar={is_user ? undefined : t("chat.avatar")}
      streaming={streaming}
      timeLabel={is_user ? t("chat.you") : t("chat.assistant")}
      header={!is_user && blocks && blocks.length > 0
        ? <ThinkingBlockList blocks={blocks} />
        : undefined}
    >
      {message.media && message.media.length > 0 && <MediaDisplay media={message.media} />}
    </MessageBubble>
  );
}
