import type { ReactNode } from "react";
import { MarkdownContent } from "../pages/chat/markdown-content";

export interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  /** 어시스턴트 아바타 (없으면 아바타 비표시) */
  avatar?: string;
  /** 스트리밍 커서 표시 */
  streaming?: boolean;
  /** 타임스탬프 옆에 role 뱃지 표시 */
  showRoleBadge?: boolean;
  /** 유저 메시지 우측 정렬 (기본 true) */
  alignUserRight?: boolean;
  /** 메시지 본문 아래 추가 콘텐츠 (미디어 등) */
  children?: ReactNode;
  /** 타임스탬프 레이블 (기본: role 기반) */
  timeLabel?: string;
}

const DIRECTION_MAP: Record<string, "user" | "assistant"> = {
  user: "user",
  assistant: "assistant",
  system: "assistant",
};

export function MessageBubble({
  role, content, at, avatar, streaming,
  showRoleBadge, alignUserRight = true, children, timeLabel,
}: MessageBubbleProps) {
  const is_user = role === "user";
  const direction = DIRECTION_MAP[role] ?? "assistant";
  const align = is_user && alignUserRight;
  const text = content ?? "";

  return (
    <div className={`chat-msg chat-msg--${direction}${align ? "" : " chat-msg--left"}`}>
      {!is_user && avatar && <div className="chat-msg__avatar">{avatar}</div>}
      <div className="chat-msg__body">
        <div className="chat-msg__content">
          {is_user
            ? text
            : streaming
              ? <span className="chat-stream-text">{text}</span>
              : <MarkdownContent content={text} />}
          {streaming && <span className="chat-cursor" />}
          {children}
        </div>
        {!streaming && (
          <div className="chat-msg__time">
            {showRoleBadge && <span className="chat-msg__role">[{role}]</span>}
            {timeLabel ?? ""}{timeLabel ? " · " : ""}
            {new Date(at).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
