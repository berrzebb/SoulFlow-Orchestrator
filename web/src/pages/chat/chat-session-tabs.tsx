/** 채팅 세션 탭바 — 세션 목록 탭 + 컨텍스트 메뉴 + 인라인 리네임 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import type { ChatSessionSummary } from "./types";

interface ChatSessionTabsProps {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  creating: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
}

interface ContextMenu {
  id: string;
  x: number;
  y: number;
}

export function ChatSessionTabs({ sessions, activeId, creating, onSelect, onClose, onNew, onRename }: ChatSessionTabsProps) {
  const t = useT();
  const [ctx_menu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [renaming_id, setRenamingId] = useState<string | null>(null);
  const [rename_val, setRenameVal] = useState("");
  const rename_ref = useRef<HTMLInputElement>(null);
  const long_press_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 컨텍스트 메뉴 닫기 — 외부 클릭
  useEffect(() => {
    if (!ctx_menu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctx_menu]);

  // 리네임 인풋 자동 포커스
  useEffect(() => {
    if (renaming_id) rename_ref.current?.select();
  }, [renaming_id]);

  const open_ctx = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ id, x: e.clientX, y: e.clientY });
  };

  const start_rename = (s: ChatSessionSummary) => {
    setCtxMenu(null);
    setRenamingId(s.id);
    setRenameVal(s.name ?? "");
  };

  const commit_rename = (id: string) => {
    onRename(id, rename_val.trim());
    setRenamingId(null);
  };

  const copy_id = (id: string) => {
    navigator.clipboard?.writeText(id).catch(() => {});
    setCtxMenu(null);
  };

  // 터치 롱프레스 (500ms) → 컨텍스트 메뉴
  const on_touch_start = (e: React.TouchEvent, id: string) => {
    const t = e.touches[0];
    long_press_timer.current = setTimeout(() => {
      setCtxMenu({ id, x: t.clientX, y: t.clientY });
    }, 500);
  };
  const on_touch_end = () => {
    if (long_press_timer.current) clearTimeout(long_press_timer.current);
  };

  const tab_label = (s: ChatSessionSummary) => s.name ?? s.id.slice(0, 8).toUpperCase();

  return (
    <>
      <div className="chat-tabs" role="tablist" aria-label="Chat sessions">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            role="tab"
            aria-selected={s.id === activeId}
            className={`chat-tabs__tab${s.id === activeId ? " chat-tabs__tab--active" : ""}`}
            onClick={() => renaming_id !== s.id && onSelect(s.id)}
            onContextMenu={(e) => open_ctx(e, s.id)}
            onTouchStart={(e) => on_touch_start(e, s.id)}
            onTouchEnd={on_touch_end}
            onTouchMove={on_touch_end}
          >
            <span className="chat-tabs__index">{i + 1}</span>
            {renaming_id === s.id ? (
              <input
                ref={rename_ref}
                className="chat-tabs__rename-input"
                value={rename_val}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commit_rename(s.id); }
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onBlur={() => commit_rename(s.id)}
                onClick={(e) => e.stopPropagation()}
                maxLength={40}
                placeholder={s.id.slice(0, 8).toUpperCase()}
              />
            ) : (
              <span className="chat-tabs__id">{tab_label(s)}</span>
            )}
            <span
              role="button"
              className="chat-tabs__close"
              onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
              aria-label={t("chat.delete_session")}
            >
              ×
            </span>
          </div>
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

      {/* 컨텍스트 메뉴 — createPortal로 body에 마운트해 ancestor transform 영향 제거 */}
      {ctx_menu && (() => {
        const session = sessions.find((s) => s.id === ctx_menu.id);
        if (!session) return null;
        const menu_x = Math.min(ctx_menu.x, window.innerWidth - 224);
        const menu_y = Math.min(ctx_menu.y, window.innerHeight - 160);
        return createPortal(
          <div
            className="chat-ctx-menu"
            style={{ top: menu_y, left: menu_x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="chat-ctx-menu__header">
              <span className="chat-ctx-menu__title">{tab_label(session)}</span>
              <span className="chat-ctx-menu__sub">{session.id}</span>
            </div>
            <button className="chat-ctx-menu__item" onClick={() => copy_id(session.id)}>
              📋 {t("chat.copy_session_id")}
            </button>
            <button className="chat-ctx-menu__item" onClick={() => start_rename(session)}>
              ✏️ {t("chat.rename_tab")}
            </button>
            <button className="chat-ctx-menu__item chat-ctx-menu__item--danger" onClick={() => { onClose(session.id); setCtxMenu(null); }}>
              🗑 {t("chat.delete_session")}
            </button>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}
