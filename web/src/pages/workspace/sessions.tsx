import { useState, useMemo } from "react";
import { useTableFilter } from "../../hooks/use-table-filter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { SearchInput } from "../../components/search-input";
import { ChipBar } from "../../components/chip-bar";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";
import { SplitPane } from "./split-pane";
import { WsListItem, WsDetailHeader, WsSkeletonCol } from "./ws-shared";
import { useAuthStatus, useAuthUser } from "../../hooks/use-auth";

interface SessionEntry {
  key: string;
  provider: string;
  chat_id: string;
  alias: string;
  thread: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  /** FE-2: 세션 소유자 — 백엔드가 포함할 경우 존재. */
  user_id?: string;
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

  const { data: auth_status } = useAuthStatus();
  const { data: auth_user } = useAuthUser();

  // FE-2: 슈퍼어드민은 전체 세션 조회 가능 — 기본값: 본인 세션만 표시
  const [show_all, set_show_all] = useState(false);
  const is_superadmin = auth_user?.role === "superadmin";
  const auth_enabled = auth_status?.enabled ?? false;

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

  // FE-2: auth 활성 + 비슈퍼어드민이면 본인 세션만 표시 (백엔드 user_id 기반).
  // user_id 미제공 시 신뢰는 백엔드 스코핑에 위임.
  const scoped_sessions = useMemo(() => {
    if (!auth_enabled || !auth_user?.sub) return sessions;
    if (is_superadmin && show_all) return sessions;
    return sessions.filter((s) => !s.user_id || s.user_id === auth_user.sub);
  }, [sessions, auth_enabled, auth_user, is_superadmin, show_all]);

  // 필터 없는 스코프 세션에서 프로바이더 목록 파생 (별도 API 호출 제거)
  const providers = useMemo(
    () => Array.from(new Set(scoped_sessions.map((s) => s.provider))).sort(),
    [scoped_sessions],
  );

  const { filtered: filtered_sessions, search, setSearch } = useTableFilter(scoped_sessions, {
    searchFields: ["chat_id", "alias", "provider"],
  });

  const selected_session = scoped_sessions.find((s) => s.key === selected);

  return (
    <SplitPane
      showRight={!!selected}
      left={
        <div className="ws-col">
          <div className="ws-search-bar">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("workspace.sessions.search")}
              onClear={() => setSearch("")}
              autoFocus
              className="ws-search-bar__input"
            />
          </div>
          {/* FE-2: 슈퍼어드민 전용 — 전체/내 세션 전환 */}
          {is_superadmin && (
            <div className="ws-scope-toggle">
              <button
                className={`btn btn--xs${show_all ? " btn--ok" : " btn--ghost"}`}
                onClick={() => { set_show_all((v) => !v); setSelected(null); }}
                aria-pressed={show_all}
              >
                {show_all ? t("workspace.sessions.showing_all") : t("workspace.sessions.showing_mine")}
              </button>
            </div>
          )}
          <ChipBar
            options={[
              { value: "", label: t("workspace.sessions.all_channels") },
              ...providers.map((p) => ({ value: p, label: p })),
            ]}
            value={provider_filter}
            onChange={(v) => { setProviderFilter(v); setSelected(null); }}
          />
          <div className="ws-scroll">
            {filtered_sessions.length === 0 ? (
              <EmptyState
                icon={search ? "🔍" : "💬"}
                title={search ? t("workspace.sessions.no_match") : t("workspace.sessions.no_sessions")}
              />
            ) : filtered_sessions.map((s) => {
              const is_foreign = is_superadmin && show_all && !!s.user_id && s.user_id !== auth_user?.sub;
              return (
              <WsListItem key={s.key} id={s.key} active={selected === s.key} onClick={() => setSelected(s.key)}>
                <div className="li-flex mb-0">
                  <Badge status={s.provider} variant="info" />
                  <span className="fw-600 truncate flex-fill">{s.chat_id}</span>
                  {is_foreign && (
                    <span className="text-xs text-muted" title={t("workspace.sessions.foreign_session")} aria-label={t("workspace.sessions.foreign_session")}>⚠</span>
                  )}
                  <span className="text-xs text-muted">{s.message_count}</span>
                </div>
                <div className="text-xs text-muted">
                  {s.alias && s.alias !== s.provider && <span className="mr-1">{s.alias}</span>}
                  {s.thread && s.thread !== "main" && <span className="mr-1">#{s.thread}</span>}
                  <span title={s.updated_at}>{time_ago(s.updated_at)}</span>
                </div>
              </WsListItem>
              );
            })}
          </div>
        </div>
      }
      right={
        <div className="ws-col">
          <WsDetailHeader onBack={() => setSelected(null)}>
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
          </WsDetailHeader>
          <div className="ws-preview ws-msg-list">
            {!selected ? (
              <EmptyState icon="💬" title={t("workspace.select_item")} />
            ) : !detail ? (
              <WsSkeletonCol rows={["row", "row", "row"]} />
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
