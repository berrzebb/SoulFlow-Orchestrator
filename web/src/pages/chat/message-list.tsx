import { forwardRef } from "react";
import { EmptyState } from "../../components/empty-state";
import { useT } from "../../i18n";
import { ChatMessageBubble } from "./message-bubble";
import { ToolCallList } from "./tool-call-block";
import { ApprovalBanner } from "../../components/approval-banner";
import type { PendingApproval } from "../../components/approval-banner";
import type { ToolCallEntry, ThinkingEntry } from "../../hooks/use-ndjson-stream";
import type { ChatMessage } from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  sending: boolean;
  last_is_user: boolean;
  is_streaming: boolean;
  tool_calls?: ToolCallEntry[];
  thinking_blocks?: ThinkingEntry[];
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
          <EmptyState icon="💬" title={t("chat.no_messages")} />
        )}

        {props.messages.map((m, i) => {
          const is_streaming_bubble = props.is_streaming && i === last_idx && m.direction === "assistant";
          return (
            <ChatMessageBubble
              key={`${m.at}-${m.direction}-${i}`}
              message={m}
              streaming={is_streaming_bubble}
              thinking_blocks={is_streaming_bubble ? props.thinking_blocks : undefined}
            />
          );
        })}

        {/* 스트리밍 중 도구 호출 블록 — 마지막 버블 아래 */}
        {props.is_streaming && props.tool_calls && props.tool_calls.length > 0 && (
          <ToolCallList calls={props.tool_calls} />
        )}

        {props.pending_approvals.map((ap) => (
          <ApprovalBanner
            key={ap.request_id}
            approval={ap}
            onResolve={(text) => props.onResolveApproval(ap.request_id, text)}
          />
        ))}
      </div>
    </div>
  );
});
