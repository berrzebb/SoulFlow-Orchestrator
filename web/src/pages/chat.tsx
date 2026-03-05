import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useMemo } from "react";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { useToast } from "../components/toast";
import { useDashboardStore } from "../store";
import { useT } from "../i18n";
import { MessageList } from "./chat/message-list";
import { ChatInputBar } from "./chat/chat-input-bar";
import { EmptyState } from "./chat/empty-state";
import type { ChatSessionSummary, ChatSession, ChatMessage, ChatMediaItem, PendingApproval } from "./chat/types";

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
  const set_web_stream = useDashboardStore((s) => s.set_web_stream);

  const { data: sessions = [] } = useQuery<ChatSessionSummary[]>({
    queryKey: ["chat-sessions"],
    queryFn: () => api.get("/api/chat/sessions"),
    refetchInterval: 5000,
  });

  const { data: activeSession } = useQuery<ChatSession>({
    queryKey: ["chat-session", activeId],
    queryFn: () => api.post<ChatSession>("/api/chat/sessions", { action: "get", id: activeId }),
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
    await api.del("/api/chat/sessions", { id });
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

  const send = async () => {
    if (!activeId || (!input.trim() && pending_media.length === 0) || sending) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { content: input.trim() };
      if (pending_media.length > 0) body.media = pending_media;
      await api.post("/api/chat/sessions", { action: "send", id: activeId, ...body });
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
      await api.post("/api/approvals", { approval_id: request_id, text });
      toast(t("chat.approval_done"), "ok");
      void qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      void qc.invalidateQueries({ queryKey: ["chat-session", activeId] });
    } catch {
      toast(t("chat.approval_failed"), "err");
    }
  };

  const raw_messages = activeSession?.messages ?? [];
  const stream_active = web_stream?.chat_id === activeId && !!web_stream.content;
  const is_streaming = stream_active && !web_stream!.done;

  // done 후 refetch된 메시지가 도착하면 web_stream 정리
  useEffect(() => {
    if (!web_stream?.done || web_stream.chat_id !== activeId) return;
    const last = raw_messages[raw_messages.length - 1];
    if (last?.direction === "assistant") set_web_stream(null);
  }, [raw_messages, web_stream, activeId, set_web_stream]);

  // 스트리밍 콘텐츠를 가상 메시지로 합쳐서 연속적 버블링
  const messages = useMemo(() => {
    if (!stream_active) return raw_messages;
    const virtual_msg: ChatMessage = {
      direction: "assistant",
      content: web_stream!.content,
      at: new Date().toISOString(),
    };
    return [...raw_messages, virtual_msg];
  }, [raw_messages, stream_active, web_stream?.content]);

  const last_msg = messages.length > 0 ? messages[messages.length - 1] : null;
  const last_is_user = last_msg?.direction === "user";
  const can_send = !sending && (!!input.trim() || pending_media.length > 0);

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h2 style={{ margin: 0, fontSize: "var(--fs-md)" }}>{t("chat.title")}</h2>
        <select
          className="chat-header__select"
          value={activeId ?? ""}
          onChange={(e) => setActiveId(e.target.value || null)}
        >
          <option value="">{t("chat.select_session")}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id.slice(0, 16)} ({t("chat.msgs_fmt", { count: s.message_count })})
            </option>
          ))}
        </select>
        <button className="btn btn--sm btn--ok" onClick={() => void create_session()}>
          {t("chat.new_session")}
        </button>
        {activeId && (
          <button className="btn btn--xs btn--danger" onClick={() => void delete_session(activeId)}>
            ✕
          </button>
        )}
        {pending_approvals.length > 0 && (
          <Badge status={`🔐 ${pending_approvals.length}`} variant="warn" />
        )}
      </div>

      {!activeId ? (
        <EmptyState onNewSession={create_session} />
      ) : (
        <>
          <MessageList
            ref={messagesRef}
            messages={messages}
            sending={sending}
            last_is_user={last_is_user}
            is_streaming={is_streaming}
            pending_approvals={pending_approvals}
            onResolveApproval={(id, text) => void resolve_approval(id, text)}
          />
          <ChatInputBar
            input={input}
            setInput={setInput}
            sending={sending}
            can_send={can_send}
            onSend={() => void send()}
            pending_media={pending_media}
            onAttach={() => fileInputRef.current?.click()}
            onRemoveMedia={(idx) => setPendingMedia((prev) => prev.filter((_, i) => i !== idx))}
          />
          <input
            type="file"
            ref={fileInputRef}
            onChange={handle_file}
            multiple
            accept="image/*,.pdf,.txt,.md,.csv,.json"
            style={{ display: "none" }}
          />
        </>
      )}
    </div>
  );
}
