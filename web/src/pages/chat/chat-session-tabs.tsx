/** 채팅 세션 탭바 — 세션 목록을 탭으로 표시, + 버튼으로 새 세션 추가 */

import type { ChatSessionSummary } from "./types";

interface ChatSessionTabsProps {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  creating: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function ChatSessionTabs({ sessions, activeId, creating, onSelect, onClose, onNew }: ChatSessionTabsProps) {
  return (
    <div className="chat-tabs" role="tablist" aria-label="Chat sessions">
      {sessions.map((s, i) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={s.id === activeId}
          className={`chat-tabs__tab${s.id === activeId ? " chat-tabs__tab--active" : ""}`}
          onClick={() => onSelect(s.id)}
        >
          <span className="chat-tabs__index">{i + 1}</span>
          <span className="chat-tabs__id">{s.id.slice(0, 8).toUpperCase()}</span>
          <span
            role="button"
            className="chat-tabs__close"
            onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
            aria-label={`Close session ${s.id.slice(0, 8)}`}
          >
            ×
          </span>
        </button>
      ))}
      <button
        className="chat-tabs__add"
        onClick={onNew}
        disabled={creating}
        aria-label="New session"
      >
        +
      </button>
    </div>
  );
}
