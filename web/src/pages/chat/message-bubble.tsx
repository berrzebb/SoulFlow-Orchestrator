import { useT } from "../../i18n";
import { MessageBubble } from "../../components/message-bubble";
import { MediaDisplay } from "./media-preview";
import type { ChatMessage } from "./types";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  streaming?: boolean;
}

export function ChatMessageBubble({ message, streaming }: ChatMessageBubbleProps) {
  const t = useT();
  const is_user = message.direction === "user";

  return (
    <MessageBubble
      role={is_user ? "user" : "assistant"}
      content={message.content ?? ""}
      at={message.at}
      avatar={is_user ? undefined : t("chat.avatar")}
      streaming={streaming}
      timeLabel={is_user ? t("chat.you") : t("chat.assistant")}
    >
      {message.media && message.media.length > 0 && <MediaDisplay media={message.media} />}
    </MessageBubble>
  );
}
