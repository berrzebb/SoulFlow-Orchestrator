/** 세션 브라우저 — 햄버거 메뉴에서 열리는 전체 세션 목록 (대시보드 + 미러) */

import { useState } from "react";
import { useT } from "../../i18n";
import type { ChatSessionSummary } from "./types";

type MirrorEntry = { key: string; provider: string; chat_id: string; alias: string; message_count: number; updated_at?: string };

interface SessionBrowserProps {
  sessions: ChatSessionSummary[];
  mirror_sessions: MirrorEntry[];
  active_id: string | null;
  mirror_key: string | null;
  creating: boolean;
  onSelectSession: (id: string) => void;
  onSelectMirror: (key: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function time_ago(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function SessionBrowser({
  sessions, mirror_sessions, active_id, mirror_key,
  creating, onSelectSession, onSelectMirror, onNew, onRename, onDelete,
}: SessionBrowserProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [renaming_id, setRenamingId] = useState<string | null>(null);
  const [rename_val, setRenameVal] = useState("");

  const q = search.toLowerCase();
  const filtered_sessions = sessions.filter((s) =>
    !q || s.id.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q)
  );
  const filtered_mirror = mirror_sessions.filter((m) =>
    !q || m.key.toLowerCase().includes(q) || (m.alias ?? "").toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  );

  const commit_rename = (id: string) => {
    onRename(id, rename_val.trim());
    setRenamingId(null);
  };

  const start_rename = (s: ChatSessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(s.id);
    setRenameVal(s.name ?? "");
  };

  return (
    <div className="session-browser">
      {/* 상단 액션바 */}
      <div className="session-browser__toolbar">
        <input
          className="session-browser__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("chat.session_search_placeholder")}
          autoFocus
        />
        <button
          className="session-browser__new btn btn--sm"
          onClick={onNew}
          disabled={creating}
        >
          + {t("chat.new_session")}
        </button>
      </div>

      <div className="session-browser__list">
        {/* 대시보드 세션 */}
        {filtered_sessions.length > 0 && (
          <div className="session-browser__group">
            <div className="session-browser__group-label">Chat</div>
            {filtered_sessions.map((s, i) => {
              const is_active = s.id === active_id;
              return (
                <div
                  key={s.id}
                  className={`session-browser__item${is_active ? " session-browser__item--active" : ""}`}
                  onClick={() => renaming_id !== s.id && onSelectSession(s.id)}
                >
                  <span className="session-browser__item-index">{i + 1}</span>
                  <div className="session-browser__item-body">
                    {renaming_id === s.id ? (
                      <input
                        className="session-browser__rename-input"
                        autoFocus
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
                      <span className="session-browser__item-name">
                        {s.name ?? s.id.slice(0, 8).toUpperCase()}
                      </span>
                    )}
                    <div className="session-browser__item-meta">
                      <span className="session-browser__badge session-browser__badge--chat">CHAT</span>
                      <span className="session-browser__meta-id">{s.id.slice(0, 8).toUpperCase()}</span>
                      <span className="session-browser__meta-msgs">{s.message_count} msg</span>
                      <span className="session-browser__meta-time">{time_ago(s.created_at)}</span>
                    </div>
                  </div>
                  <div className="session-browser__item-actions">
                    <button
                      className="session-browser__action-btn"
                      onClick={(e) => start_rename(s, e)}
                      aria-label={t("chat.rename_tab")}
                    >✏️</button>
                    <button
                      className="session-browser__action-btn session-browser__action-btn--danger"
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                      aria-label={t("chat.delete_session")}
                    >🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 미러(채널) 세션 */}
        {filtered_mirror.length > 0 && (
          <div className="session-browser__group">
            <div className="session-browser__group-label">Mirror</div>
            {filtered_mirror.map((m) => {
              const is_active = m.key === mirror_key;
              return (
                <div
                  key={m.key}
                  className={`session-browser__item${is_active ? " session-browser__item--active" : ""}`}
                  onClick={() => onSelectMirror(m.key)}
                >
                  <span className="session-browser__item-index">⇄</span>
                  <div className="session-browser__item-body">
                    <span className="session-browser__item-name">
                      {m.alias || m.chat_id}
                    </span>
                    <div className="session-browser__item-meta">
                      <span className="session-browser__badge session-browser__badge--mirror">{m.provider.toUpperCase()}</span>
                      <span className="session-browser__meta-id">{m.chat_id.slice(0, 8).toUpperCase()}</span>
                      <span className="session-browser__meta-msgs">{m.message_count} msg</span>
                      {m.updated_at && <span className="session-browser__meta-time">{time_ago(m.updated_at)}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filtered_sessions.length === 0 && filtered_mirror.length === 0 && (
          <div className="session-browser__empty">{t("chat.no_sessions")}</div>
        )}
      </div>
    </div>
  );
}
