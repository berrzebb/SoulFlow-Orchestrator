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
    queryFn: () => api.get(`/api/sessions/${encodeURIComponent(selected!)}`),
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
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* 채널 필터 */}
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 4, flexShrink: 0 }}>
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
          {/* 세션 목록 */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {sessions.length === 0 ? (
              <p className="empty" style={{ padding: 14, fontSize: 12 }}>{t("workspace.sessions.no_sessions")}</p>
            ) : sessions.map((s) => (
              <div
                key={s.key}
                onClick={() => setSelected(s.key)}
                style={{
                  padding: "10px 14px", cursor: "pointer", fontSize: 12,
                  background: selected === s.key ? "var(--panel-elevated)" : "none",
                  borderLeft: selected === s.key ? "3px solid var(--accent)" : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <Badge status={s.provider} variant="info" />
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {s.chat_id}
                  </span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 10 }}>
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
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {selected_session ? (
              <>
                <Badge status={selected_session.provider} variant="info" />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{selected_session.chat_id}</span>
                {selected_session.thread !== "main" && (
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>#{selected_session.thread}</span>
                )}
              </>
            ) : (
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t("workspace.select_item")}</span>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {!selected ? (
              <p className="empty">{t("workspace.select_item")}</p>
            ) : !detail ? (
              <p className="empty">{t("common.loading")}</p>
            ) : detail.messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.direction === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%", padding: "8px 12px", borderRadius: 8, fontSize: 12,
                background: m.direction === "user" ? "rgba(74,158,255,0.15)" : "var(--panel-elevated)",
                color: "var(--text)", lineHeight: 1.5,
              }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
                  {m.direction === "user" ? "user" : "assistant"} · {m.at.slice(0, 16)}
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
