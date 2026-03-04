import { useT } from "../../i18n";
import { MarkdownContent } from "./markdown-content";
import { MediaDisplay } from "./media-preview";
import type { ChatMessage } from "./types";

interface MessageBubbleProps {
  message: ChatMessage;
  streaming?: boolean;
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const t = useT();
  const is_user = message.direction === "user";
  const text = message.content ?? "";

  return (
    <div className={`chat-msg chat-msg--${message.direction}`}>
      {!is_user && <div className="chat-msg__avatar">{t("chat.avatar")}</div>}
      <div className="chat-msg__body">
        <div className="chat-msg__content">
          {is_user
            ? text.trim() !== " " && text
            : <MarkdownContent content={text} />
          }
          {streaming && <span className="chat-cursor" />}
          {message.media && message.media.length > 0 && <MediaDisplay media={message.media} />}
        </div>
        {!streaming && (
          <div className="chat-msg__time">
            {is_user ? t("chat.you") : t("chat.assistant")} · {new Date(message.at).toLocaleTimeString("sv-SE")}
          </div>
        )}
      </div>
    </div>
  );
}
