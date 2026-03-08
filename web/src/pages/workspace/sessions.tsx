import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";
import { SplitPane } from "./split-pane";

interface SessionEntry {
  key: string;
  provider: string;
  chat_id: string;
  alias: string;
  thread: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}
interface SessionDetail {
  key: string;
  provider: string;
  chat_id: string;
  created_at: string;
  messages: Array<{ direction: "user" | "assistant"; content: string; at: string }>;
}

export function SessionsTab() {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [provider_filter, setProviderFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: sessions = [] } = useQuery<SessionEntry[]>({
    queryKey: ["ws-sessions", provider_filter],
    queryFn: () => api.get(`/api/sessions${provider_filter ? `?provider=${encodeURIComponent(provider_filter)}` : ""}`),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const { data: detail } = useQuery<SessionDetail>({
    queryKey: ["ws-session-detail", selected],
    queryFn: () => api.get(`/api/sessions/${encodeURIComponent(selected!)}`),
    enabled: !!selected,
    staleTime: 5_000,
  });

  // 필터 없는 세션 데이터에서 프로바이더 목록 캐시 (별도 API 호출 제거)
  const providersRef = useRef<string[]>([]);
  if (!provider_filter && sessions.length > 0) {
    providersRef.current = Array.from(new Set(sessions.map((s) => s.provider))).sort();
  }
  const providers = providersRef.current;

  const filtered_sessions = sessions.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.chat_id.toLowerCase().includes(q) || s.alias.toLowerCase().includes(q) || s.provider.toLowerCase().includes(q);
  });

  const selected_session = sessions.find((s) => s.key === selected);

  return (
    <SplitPane
      showRight={!!selected}
      left={
        <div className="ws-col">
          <div className="ws-search-bar">
            <input
              autoFocus
              className="input input--sm ws-search-bar__input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("workspace.sessions.search")}
            />
          </div>
          <div className="ws-chip-bar">
            <button
              type="button"
              className={`filter-chip${!provider_filter ? " filter-chip--active" : ""}`}
              onClick={() => { setProviderFilter(""); setSelected(null); }}
            >
              {t("workspace.sessions.all_channels")}
            </button>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                className={`filter-chip${provider_filter === p ? " filter-chip--active" : ""}`}
                onClick={() => { setProviderFilter(p); setSelected(null); }}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="ws-scroll">
            {filtered_sessions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__icon">{search ? "🔍" : "💬"}</div>
                <div className="empty-state__text">{search ? (t("workspace.sessions.no_match")) : t("workspace.sessions.no_sessions")}</div>
              </div>
            ) : filtered_sessions.map((s) => (
              <div key={s.key} role="button" tabIndex={0} onClick={() => setSelected(s.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s.key); } }} className={`ws-item${selected === s.key ? " ws-item--active" : ""}`}>
                <div className="li-flex mb-0">
                  <Badge status={s.provider} variant="info" />
                  <span className="fw-600 truncate flex-fill">{s.chat_id}</span>
                  <span className="text-xs text-muted">{s.message_count}</span>
                </div>
                <div className="text-xs text-muted">
                  {s.alias && s.alias !== s.provider && <span className="mr-1">{s.alias}</span>}
                  {s.thread && s.thread !== "main" && <span className="mr-1">#{s.thread}</span>}
                  <span title={s.updated_at}>{time_ago(s.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      right={
        <div className="ws-col">
          <div className="ws-detail-header">
            <button className="ws-back-btn" onClick={() => setSelected(null)}>{t("common.back")}</button>
            {selected_session ? (
              <>
                <Badge status={selected_session.provider} variant="info" />
                <span className="fw-600 text-sm">{selected_session.chat_id}</span>
                {selected_session.thread !== "main" && (
                  <span className="text-xs text-muted">#{selected_session.thread}</span>
                )}
              </>
            ) : (
              <span className="fw-600 text-sm">{t("workspace.select_item")}</span>
            )}
          </div>
          <div className="ws-preview ws-msg-list">
            {!selected ? (
              <div className="empty-state">
                <div className="empty-state__icon">💬</div>
                <div className="empty-state__text">{t("workspace.select_item")}</div>
              </div>
            ) : !detail ? (
              <div className="ws-skeleton-col">
                <div className="skeleton skeleton--row" />
                <div className="skeleton skeleton--row" />
                <div className="skeleton skeleton--row" />
              </div>
            ) : detail.messages.map((m, i) => (
              <div key={i} className={`ws-msg ws-msg--${m.direction}`}>
                <div className="ws-msg__header">
                  {m.direction === "user" ? t("chat.you") : t("chat.assistant")} · <span title={m.at}>{time_ago(m.at)}</span>
                </div>
                <pre className="ws-msg__content">{m.content}</pre>
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
}
