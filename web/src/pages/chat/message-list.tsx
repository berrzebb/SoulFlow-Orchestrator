import { forwardRef } from "react";
import { useT } from "../../i18n";
import { ChatMessageBubble } from "./message-bubble";
import { ApprovalBanner } from "../../components/approval-banner";
import type { PendingApproval } from "../../components/approval-banner";
import type { ChatMessage } from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  sending: boolean;
  last_is_user: boolean;
  is_streaming: boolean;
  pending_approvals: PendingApproval[];
  onResolveApproval: (id: string, text: string) => void;
}

export const MessageList = forwardRef<HTMLDivElement, MessageListProps>(function MessageList(props, ref) {
  const t = useT();
  const last_idx = props.messages.length - 1;

  return (
    <div className="chat-messages" ref={ref}>
      <div className="chat-messages__inner">
        {!props.messages.length && !props.pending_approvals.length && (
          <div className="empty-state"><div className="empty-state__icon">💬</div><div className="empty-state__text">{t("chat.no_messages")}</div></div>
        )}

        {props.messages.map((m, i) => (
          <ChatMessageBubble
            key={`${m.at}-${m.direction}-${i}`}
            message={m}
            streaming={props.is_streaming && i === last_idx && m.direction === "assistant"}
          />
        ))}

        {props.pending_approvals.map((ap) => (
          <ApprovalBanner
            key={ap.request_id}
            approval={ap}
            onResolve={(text) => props.onResolveApproval(ap.request_id, text)}
          />
        ))}

        {props.sending && props.last_is_user && !props.is_streaming && (
          <div className="chat-msg chat-msg--assistant">
            <div className="chat-msg__avatar">{t("chat.avatar")}</div>
            <div className="chat-msg__body">
              <div className="chat-msg__content chat-typing">
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
