import { useRef, useEffect, useState, type ReactNode } from "react";
import { MarkdownContent } from "../pages/chat/markdown-content";

/** 스트리밍 버블의 min-height를 스크롤 컨테이너의 남은 공간으로 계산. */
function useStreamingMinHeight(enabled: boolean): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled || !ref.current) { setHeight(0); return; }
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const container = el.closest(".chat-messages") as HTMLElement | null;
      if (!container) return;
      const remaining = container.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 16;
      setHeight(Math.max(remaining, 80));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [enabled]);

  return [ref, height];
}

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
  const [contentRef, streaming_height] = useStreamingMinHeight(!is_user && !!streaming);

  return (
    <div className={`chat-msg chat-msg--${direction}${align ? "" : " chat-msg--left"}`}>
      {!is_user && avatar && <div className="chat-msg__avatar">{avatar}</div>}
      <div className="chat-msg__body">
        <div
          ref={contentRef}
          className="chat-msg__content"
          style={streaming && streaming_height ? { minHeight: streaming_height } : undefined}
        >
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
