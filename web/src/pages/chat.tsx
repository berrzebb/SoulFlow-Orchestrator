import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { useToast } from "../components/toast";
import { useDashboardStore } from "../store";
import { useT } from "../i18n";

interface ChatMediaItem {
  type: string;
  url: string;
  mime?: string;
  name?: string;
}

interface ChatSessionSummary {
  id: string;
  created_at: string;
  message_count: number;
}

interface ChatMessage {
  direction: "user" | "assistant";
  content: string;
  at: string;
  media?: ChatMediaItem[];
}

interface ChatSession {
  id: string;
  created_at: string;
  messages: ChatMessage[];
}

interface PendingApproval {
  request_id: string;
  tool_name: string;
  status: string;
  created_at: string;
  params?: Record<string, unknown>;
  context?: { channel?: string; chat_id?: string; task_id?: string };
}

function MediaDisplay({ media }: { media: ChatMediaItem[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {media.map((m, i) => {
        const is_image = m.type === "image" || (m.mime ?? "").startsWith("image/");
        if (is_image && m.url) {
          return (
            <img
              key={i}
              src={m.url}
              alt={m.name ?? "image"}
              style={{ maxWidth: 240, maxHeight: 180, borderRadius: 4, border: "1px solid var(--line)", objectFit: "cover", cursor: "pointer" }}
              onClick={() => window.open(m.url, "_blank")}
              title={m.name ?? "image"}
            />
          );
        }
        return (
          <a
            key={i}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
              padding: "3px 8px", borderRadius: 4, border: "1px solid var(--line)",
              background: "rgba(255,255,255,0.04)", color: "var(--accent)", textDecoration: "none",
            }}
          >
            📎 {m.name ?? m.type}
          </a>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pending_media, setPendingMedia] = useState<ChatMediaItem[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const web_stream = useDashboardStore((s) => s.web_stream);

  const { data: sessions = [] } = useQuery<ChatSessionSummary[]>({
    queryKey: ["chat-sessions"],
    queryFn: () => api.get("/api/chat/sessions"),
    refetchInterval: 5000,
  });

  const { data: activeSession } = useQuery<ChatSession>({
    queryKey: ["chat-session", activeId],
    queryFn: () => api.get(`/api/chat/sessions/${activeId}`),
    enabled: !!activeId,
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
  });

  const { data: pending_approvals = [] } = useQuery<PendingApproval[]>({
    queryKey: ["approvals-pending"],
    queryFn: () => api.get("/api/approvals?status=pending"),
    refetchInterval: 4000,
  });

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [activeSession?.messages?.length, web_stream?.content]);

  const create_session = async () => {
    const res = await api.post<{ id: string }>("/api/chat/sessions");
    setActiveId(res.id);
    toast(t("chat.session_created"), "ok");
    void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
  };

  const delete_session = async (id: string) => {
    await api.del(`/api/chat/sessions/${id}`);
    if (activeId === id) setActiveId(null);
    toast(t("chat.session_deleted"), "ok");
    void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
  };

  const handle_file = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string;
        if (!url) return;
        const type = file.type.startsWith("image/") ? "image" : "file";
        setPendingMedia((prev) => [...prev, { type, url, mime: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const remove_media = (idx: number) => {
    setPendingMedia((prev) => prev.filter((_, i) => i !== idx));
  };

  const send = async () => {
    if (!activeId || (!input.trim() && pending_media.length === 0) || sending) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { content: input.trim() };
      if (pending_media.length > 0) body.media = pending_media;
      await api.post(`/api/chat/sessions/${activeId}/send`, body);
      setInput("");
      setPendingMedia([]);
      void qc.invalidateQueries({ queryKey: ["chat-session", activeId] });
    } catch {
      toast(t("chat.send_failed"), "err");
    } finally {
      setSending(false);
    }
  };

  const resolve_approval = async (request_id: string, text: string) => {
    try {
      await api.post(`/api/approvals/${encodeURIComponent(request_id)}/resolve`, { text });
      toast(t("chat.approval_done"), "ok");
      void qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      void qc.invalidateQueries({ queryKey: ["chat-session", activeId] });
    } catch {
      toast(t("chat.approval_failed"), "err");
    }
  };

  const messages = activeSession?.messages ?? [];
  const last_msg = messages.length > 0 ? messages[messages.length - 1] : null;
  const last_is_user = last_msg?.direction === "user";
  const is_streaming = web_stream?.chat_id === activeId && !!web_stream.content;
  const can_send = !sending && (!!input.trim() || pending_media.length > 0);

  return (
    <div className="page" style={{ height: "calc(100vh - 100px)", display: "flex", flexDirection: "column" }}>
      <div className="section-header" style={{ marginBottom: 8 }}>
        <h2>
          {t("chat.title")}
          {pending_approvals.length > 0 && (
            <span style={{
              marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: "var(--radius-pill)",
              background: "rgba(217,164,65,0.15)", color: "var(--warn)", border: "1px solid rgba(217,164,65,0.3)",
            }}>
              🔐 {pending_approvals.length}
            </span>
          )}
        </h2>
        <button className="btn btn--sm btn--ok" onClick={() => void create_session()}>{t("chat.new_session")}</button>
      </div>

      <div className="split" style={{ overflow: "hidden" }}>
        {/* Sessions list */}
        <div className="split__aside split__aside--md" style={{ borderRight: "1px solid var(--line)", paddingRight: 10 }}>
          {!sessions.length && <p className="empty">{t("chat.no_sessions")}</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "6px 8px", marginBottom: 4, cursor: "pointer", fontSize: 11,
                background: activeId === s.id ? "rgba(74,158,255,0.1)" : "transparent",
                borderLeft: activeId === s.id ? "3px solid var(--accent)" : "3px solid transparent",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
              onClick={() => setActiveId(s.id)}
            >
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{s.id.slice(0, 16)}</div>
                <div>{t("chat.msgs_fmt", { count: s.message_count })}</div>
              </div>
              <button
                className="btn btn--xs btn--danger"
                onClick={(e) => { e.stopPropagation(); void delete_session(s.id); }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Chat area */}
        <div className="split__main" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* ── 대기 중인 승인 ── */}
          {pending_approvals.length > 0 && (
            <div style={{
              borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 8, flexShrink: 0,
            }}>
              <div style={{ fontSize: 11, color: "var(--warn)", marginBottom: 6, fontWeight: 600 }}>
                🔐 {t("chat.approvals_pending", { count: pending_approvals.length })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pending_approvals.map((ap) => (
                  <ApprovalCard
                    key={ap.request_id}
                    approval={ap}
                    onResolve={(text) => void resolve_approval(ap.request_id, text)}
                  />
                ))}
              </div>
            </div>
          )}

          {!activeId ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p className="empty">{t("chat.select_session")}</p>
            </div>
          ) : (
            <>
              {/* Messages */}
              <div ref={messagesRef} style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {!messages.length && <p className="empty">{t("chat.no_messages")}</p>}
                {messages.map((m, i) => (
                  <div
                    key={`${m.at}-${m.direction}-${i}`}
                    style={{
                      display: "flex",
                      justifyContent: m.direction === "user" ? "flex-end" : "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "72%", padding: "8px 12px", borderRadius: 8, fontSize: 12,
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        background: m.direction === "user" ? "rgba(74,158,255,0.15)" : "var(--panel)",
                        border: `1px solid ${m.direction === "user" ? "var(--accent)" : "var(--line)"}`,
                      }}
                    >
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                        {m.direction === "user" ? t("chat.you") : t("chat.assistant")} · {new Date(m.at).toLocaleTimeString("sv-SE")}
                      </div>
                      {m.content && m.content.trim() !== " " && m.content}
                      {m.media && m.media.length > 0 && <MediaDisplay media={m.media} />}
                    </div>
                  </div>
                ))}
                {(sending || last_is_user || is_streaming) && (
                  <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
                    <div style={{
                      maxWidth: "72%", padding: "8px 12px", borderRadius: 8, fontSize: 12,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      background: "var(--panel)", border: "1px solid var(--line)",
                      color: is_streaming ? "var(--text)" : "var(--muted)",
                    }}>
                      {is_streaming ? (
                        <>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                            {t("chat.assistant")} · {t("chat.streaming")}
                          </div>
                          {web_stream!.content}
                        </>
                      ) : t("chat.thinking")}
                    </div>
                  </div>
                )}
              </div>

              {/* 첨부 예정 미디어 미리보기 */}
              {pending_media.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0", flexShrink: 0 }}>
                  {pending_media.map((m, i) => {
                    const is_image = m.type === "image" || (m.mime ?? "").startsWith("image/");
                    return (
                      <div key={i} style={{ position: "relative" }}>
                        {is_image ? (
                          <img
                            src={m.url}
                            alt={m.name ?? ""}
                            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4, border: "1px solid var(--line)" }}
                          />
                        ) : (
                          <div style={{
                            width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center",
                            borderRadius: 4, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 10,
                            color: "var(--muted)", textAlign: "center", wordBreak: "break-all", padding: 4,
                          }}>
                            📎{m.name ? `\n${m.name.slice(0, 12)}` : ""}
                          </div>
                        )}
                        <button
                          onClick={() => remove_media(i)}
                          title={t("chat.remove_attachment")}
                          style={{
                            position: "absolute", top: -4, right: -4, width: 16, height: 16,
                            borderRadius: "50%", border: "none", background: "var(--err)", color: "#fff",
                            cursor: "pointer", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center",
                            padding: 0,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Input */}
              <div style={{ display: "flex", gap: 6, paddingTop: 8, borderTop: "1px solid var(--line)", flexShrink: 0, alignItems: "flex-end" }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handle_file}
                  multiple
                  accept="image/*,.pdf,.txt,.md,.csv,.json"
                  style={{ display: "none" }}
                />
                <button
                  className="btn btn--xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  title={t("chat.attach_file")}
                  style={{ flexShrink: 0, padding: "7px 10px" }}
                >
                  📎
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={t("chat.placeholder")}
                  disabled={sending}
                  style={{
                    flex: 1, background: "var(--bg)", color: "var(--text)",
                    border: "1px solid var(--line)", padding: "8px 12px",
                    fontFamily: "inherit", fontSize: 12, borderRadius: 4,
                  }}
                />
                <button className="btn btn--ok" onClick={() => void send()} disabled={!can_send}>
                  {sending ? t("chat.sending") : t("common.send")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({ approval, onResolve }: {
  approval: PendingApproval;
  onResolve: (text: string) => void;
}) {
  const t = useT();
  const [showParams, setShowParams] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");

  const has_params = approval.params && Object.keys(approval.params).length > 0;

  const handle_custom = () => {
    if (!customText.trim()) return;
    onResolve(customText.trim());
    setCustomText("");
    setCustomMode(false);
  };

  return (
    <div style={{
      padding: "8px 10px", borderRadius: 6, fontSize: 11,
      background: "rgba(217,164,65,0.06)", border: "1px solid rgba(217,164,65,0.25)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <Badge status={approval.tool_name} variant="warn" />
        {approval.context?.channel && <Badge status={approval.context.channel} variant="info" />}
        {approval.context?.task_id && (
          <span className="text-muted" style={{ fontSize: 10 }}>
            task:{approval.context.task_id.slice(0, 10)}
          </span>
        )}
        <span className="text-muted" style={{ fontSize: 10, marginLeft: "auto" }}>
          {new Date(approval.created_at).toLocaleTimeString("sv-SE")}
        </span>
      </div>

      {has_params && (
        <div style={{ marginBottom: 6 }}>
          <button
            onClick={() => setShowParams((v) => !v)}
            style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {showParams ? "▼" : "▶"} {t("chat.params_toggle")} ({Object.keys(approval.params!).length})
          </button>
          {showParams && (
            <pre style={{
              margin: "4px 0 0", padding: "4px 8px", fontSize: 10, lineHeight: 1.5,
              background: "rgba(255,255,255,0.03)", borderRadius: 4, overflowX: "auto",
              maxHeight: 120, overflowY: "auto",
            }}>
              {JSON.stringify(approval.params, null, 2)}
            </pre>
          )}
        </div>
      )}

      {customMode ? (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <textarea
            autoFocus
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handle_custom(); } }}
            placeholder={t("chat.custom_response_hint")}
            rows={2}
            style={{
              flex: 1, fontSize: 11, background: "var(--bg)", color: "var(--text)",
              border: "1px solid var(--line)", padding: "4px 8px", fontFamily: "inherit", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button className="btn btn--xs btn--ok" onClick={handle_custom} disabled={!customText.trim()}>
              {t("common.send")}
            </button>
            <button className="btn btn--xs" onClick={() => { setCustomMode(false); setCustomText(""); }}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn--xs btn--ok" onClick={() => onResolve("approve")} style={{ fontWeight: 600 }}>
            ✅ {t("chat.approve")}
          </button>
          <button className="btn btn--xs btn--danger" onClick={() => onResolve("deny")}>
            ❌ {t("chat.deny")}
          </button>
          <button className="btn btn--xs" onClick={() => setCustomMode(true)} style={{ color: "var(--muted)" }}>
            💬 {t("chat.custom_response")}
          </button>
        </div>
      )}
    </div>
  );
}
