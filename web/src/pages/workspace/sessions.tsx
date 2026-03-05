import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useT } from "../../i18n";
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

  const { data: sessions = [] } = useQuery<SessionEntry[]>({
    queryKey: ["ws-sessions", provider_filter],
    queryFn: () => api.get(`/api/sessions${provider_filter ? `?provider=${encodeURIComponent(provider_filter)}` : ""}`),
    refetchInterval: 15_000,
  });

  const { data: detail } = useQuery<SessionDetail>({
    queryKey: ["ws-session-detail", selected],
    queryFn: () => api.post("/api/sessions", { key: selected! }),
    enabled: !!selected,
  });

  // 전체 세션에서 프로바이더 목록 추출 (필터 칩 표시용)
  const { data: all_sessions = [] } = useQuery<SessionEntry[]>({
    queryKey: ["ws-sessions-providers"],
    queryFn: () => api.get("/api/sessions"),
    staleTime: 30_000,
  });
  const providers = Array.from(new Set(all_sessions.map((s) => s.provider))).sort();

  const selected_session = sessions.find((s) => s.key === selected);

  return (
    <SplitPane
      left={
        <div className="ws-col">
          <div className="ws-chip-bar" style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <span
              onClick={() => { setProviderFilter(""); setSelected(null); }}
              style={{
                cursor: "pointer", padding: "2px 8px", borderRadius: "var(--radius-pill)", fontSize: 10,
                background: !provider_filter ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.04)",
                color: !provider_filter ? "var(--accent)" : "var(--muted)",
                border: `1px solid ${!provider_filter ? "rgba(74,158,255,0.3)" : "transparent"}`,
                userSelect: "none",
              }}
            >
              {t("workspace.sessions.all_channels")}
            </span>
            {providers.map((p) => (
              <span
                key={p}
                onClick={() => { setProviderFilter(p); setSelected(null); }}
                style={{
                  cursor: "pointer", padding: "2px 8px", borderRadius: "var(--radius-pill)", fontSize: 10,
                  background: provider_filter === p ? "rgba(74,158,255,0.15)" : "rgba(255,255,255,0.04)",
                  color: provider_filter === p ? "var(--accent)" : "var(--muted)",
                  border: `1px solid ${provider_filter === p ? "rgba(74,158,255,0.3)" : "transparent"}`,
                  userSelect: "none",
                }}
              >
                {p}
              </span>
            ))}
          </div>
          <div className="ws-scroll">
            {sessions.length === 0 ? (
              <p className="empty" style={{ padding: 14 }}>{t("workspace.sessions.no_sessions")}</p>
            ) : sessions.map((s) => (
              <div key={s.key} onClick={() => setSelected(s.key)} className={`ws-item${selected === s.key ? " ws-item--active" : ""}`} style={{ padding: "10px 14px" }}>
                <div className="li-flex" style={{ marginBottom: 2 }}>
                  <Badge status={s.provider} variant="info" />
                  <span className="fw-600 truncate" style={{ flex: 1 }}>{s.chat_id}</span>
                </div>
                <div className="text-xs text-muted">
                  {s.alias && s.alias !== s.provider && <span style={{ marginRight: 6 }}>{s.alias}</span>}
                  {s.thread && s.thread !== "main" && <span style={{ marginRight: 6 }}>#{s.thread}</span>}
                  {t("workspace.sessions.msgs_fmt", { count: s.message_count })} · {s.updated_at.slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      right={
        <div className="ws-col">
          <div className="ws-detail-header">
            {selected_session ? (
              <>
                <Badge status={selected_session.provider} variant="info" />
                <span className="fw-600" style={{ fontSize: "var(--fs-sm)" }}>{selected_session.chat_id}</span>
                {selected_session.thread !== "main" && (
                  <span className="text-xs text-muted">#{selected_session.thread}</span>
                )}
              </>
            ) : (
              <span className="fw-600" style={{ fontSize: "var(--fs-sm)" }}>{t("workspace.select_item")}</span>
            )}
          </div>
          <div className="ws-preview" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!selected ? (
              <p className="empty">{t("workspace.select_item")}</p>
            ) : !detail ? (
              <p className="empty">{t("common.loading")}</p>
            ) : detail.messages.map((m, i) => (
              <div key={i} className={`ws-msg ws-msg--${m.direction}`} style={{
                alignSelf: m.direction === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%", borderRadius: 8,
              }}>
                <div className="ws-msg__header">
                  {m.direction === "user" ? t("chat.you") : t("chat.assistant")} · {m.at.slice(0, 16)}
                </div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{m.content}</pre>
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
}
