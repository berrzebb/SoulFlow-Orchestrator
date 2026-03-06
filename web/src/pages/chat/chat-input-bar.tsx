import { useRef, useEffect } from "react";
import { useT } from "../../i18n";
import { MediaPreviewBar } from "./media-preview";
import type { ChatMediaItem } from "./types";

interface ChatInputBarProps {
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  can_send: boolean;
  onSend: () => void;
  pending_media: ChatMediaItem[];
  onAttach?: () => void;
  onRemoveMedia?: (idx: number) => void;
}

export function ChatInputBar(props: ChatInputBarProps) {
  const t = useT();
  const textarea_ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textarea_ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [props.input]);

  const handle_key_down = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (props.can_send) props.onSend();
    }
  };

  return (
    <div className="chat-input-bar">
      {props.pending_media.length > 0 && props.onRemoveMedia && (
        <MediaPreviewBar items={props.pending_media} onRemove={props.onRemoveMedia} />
      )}
      <div className="chat-input-bar__pill">
        {props.onAttach && (
          <button
            className="chat-input-bar__btn"
            onClick={props.onAttach}
            disabled={props.sending}
            title={t("chat.attach_file")}
            aria-label={t("chat.attach_file")}
          >
            +
          </button>
        )}
        <textarea
          ref={textarea_ref}
          className="chat-input-bar__textarea"
          value={props.input}
          onChange={(e) => props.setInput(e.target.value)}
          onKeyDown={handle_key_down}
          placeholder={t("chat.placeholder")}
          disabled={props.sending}
          rows={1}
        />
        <button
          className={`chat-input-bar__btn ${props.can_send ? "chat-input-bar__btn--send" : ""}`}
          onClick={props.onSend}
          disabled={!props.can_send}
          aria-label={t("common.send")}
        >
          {props.sending ? "…" : "↑"}
        </button>
      </div>
      <div className="chat-input-bar__hint text-xs text-muted">
        Enter {t("chat.send_hint")} · Shift+Enter {t("chat.newline_hint")}
      </div>
    </div>
  );
}
