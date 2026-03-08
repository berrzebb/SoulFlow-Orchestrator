import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { DeleteConfirmModal } from "../components/modal";
import { ChatPromptBar } from "../components/chat-prompt-bar";
import { useToast } from "../components/toast";
import { useAsyncState } from "../hooks/use-async-state";
import { useApprovals } from "../hooks/use-approvals";
import { useDashboardStore } from "../store";
import { useT } from "../i18n";
import { time_ago } from "../utils/format";
import { MessageList } from "./chat/message-list";
import { EmptyState } from "./chat/empty-state";
import type { ChatSessionSummary, ChatSession, ChatMessage, ChatMediaItem } from "./chat/types";

type MirrorSessionEntry = { key: string; provider: string; chat_id: string; alias: string; thread?: string; updated_at: string; message_count: number };
type MirrorSession = { key: string; provider: string; chat_id: string; alias: string; messages: ChatMessage[] };

export default function ChatPage() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mirrorKey, setMirrorKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  /** 전송 후 어시스턴트가 응답 시작할 때까지의 대기 상태 */
  const [waiting_response, setWaitingResponse] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { pending: creating, run: run_create } = useAsyncState();
  const { pending: deleting, run: run_delete } = useAsyncState();
  const [pending_media, setPendingMedia] = useState<ChatMediaItem[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const web_stream = useDashboardStore((s) => s.web_stream);
  const set_web_stream = useDashboardStore((s) => s.set_web_stream);
  const mirror_event = useDashboardStore((s) => s.mirror_event);

  const is_mirror = !!mirrorKey;

  const { data: sessions = [] } = useQuery<ChatSessionSummary[]>({
    queryKey: ["chat-sessions"],
    queryFn: () => api.get("/api/chat/sessions"),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const { data: activeSession, isLoading: activeSessionLoading } = useQuery<ChatSession>({
    queryKey: ["chat-session", activeId],
    queryFn: () => api.get<ChatSession>(`/api/chat/sessions/${encodeURIComponent(activeId!)}`),
    enabled: !!activeId && !is_mirror,
    refetchInterval: 15_000,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  // ── 외부 채널 세션 목록 (모든 채널) ──
  const { data: mirror_sessions = [] } = useQuery<MirrorSessionEntry[]>({
    queryKey: ["mirror-sessions"],
    queryFn: () => api.get("/api/chat/mirror"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: mirrorSession, isLoading: mirrorSessionLoading } = useQuery<MirrorSession>({
    queryKey: ["mirror-session", mirrorKey],
    queryFn: () => api.get<MirrorSession>(`/api/chat/mirror/${encodeURIComponent(mirrorKey!)}`),
    enabled: is_mirror,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  // Mirror 실시간 메시지 (SSE)
  const [mirrorLiveMessages, setMirrorLiveMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!is_mirror || !mirror_event) return;
    if (mirror_event.session_key !== mirrorKey) return;
    setMirrorLiveMessages((prev) => [
      ...prev,
      { direction: mirror_event.direction as "user" | "assistant", content: mirror_event.content, at: mirror_event.at },
    ]);
  }, [mirror_event, mirrorKey, is_mirror]);

  // mirrorKey 변경 시 라이브 메시지 초기화
  useEffect(() => { setMirrorLiveMessages([]); }, [mirrorKey]);

  const select_mirror = (key: string) => {
    setMirrorKey(key);
    setActiveId(null);
  };

  const select_session = (id: string | null) => {
    setActiveId(id);
    setMirrorKey(null);
  };

  const { pending: pending_approvals, resolve: resolve_approval } = useApprovals({
    related_query_keys: activeId ? [["chat-session", activeId]] : [],
  });

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [activeSession?.messages?.length, mirrorLiveMessages.length, !!web_stream?.content]);

  const create_session = () => run_create(async () => {
    const res = await api.post<{ id: string }>("/api/chat/sessions");
    setActiveId(res.id);
    void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
  }, t("chat.session_created"), t("chat.create_failed"));

  const delete_session = (id: string) => run_delete(async () => {
    await api.del(`/api/chat/sessions/${encodeURIComponent(id)}`);
    if (activeId === id) setActiveId(null);
    void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
  }, t("chat.session_deleted"), t("chat.delete_failed"));

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
    setWaitingResponse(true);
    try {
      const body: Record<string, unknown> = { content: input.trim() };
      if (pending_media.length > 0) body.media = pending_media;
      if (selectedProvider) body.provider_instance_id = selectedProvider;
      if (selectedModel) body.model = selectedModel;
      await api.post(`/api/chat/sessions/${encodeURIComponent(activeId!)}/messages`, body);
      setInput("");
      setPendingMedia([]);
      void qc.invalidateQueries({ queryKey: ["chat-session", activeId] });
    } catch {
      toast(t("chat.send_failed"), "err");
      setWaitingResponse(false);
    } finally {
      setSending(false);
    }
  };

  const send_mirror = async () => {
    if (!mirrorKey || !input.trim() || sending) return;
    setSending(true);
    setWaitingResponse(true);
    try {
      await api.post(`/api/chat/mirror/${encodeURIComponent(mirrorKey)}/messages`, { content: input.trim() });
      setInput("");
    } catch {
      toast(t("chat.send_failed"), "err");
      setWaitingResponse(false);
    } finally {
      setSending(false);
    }
  };

  const raw_messages = is_mirror
    ? [...(mirrorSession?.messages ?? []), ...mirrorLiveMessages]
    : activeSession?.messages ?? [];
  const stream_active = !is_mirror && web_stream?.chat_id === activeId && !!web_stream.content;
  const is_streaming = stream_active && !web_stream!.done;

  // 스트리밍 시작 or 어시스턴트 메시지 도착 시 대기 상태 해제
  useEffect(() => {
    if (!waiting_response) return;
    const last = raw_messages[raw_messages.length - 1];
    if (is_streaming || last?.direction === "assistant") setWaitingResponse(false);
  }, [raw_messages, is_streaming, waiting_response]);

  // done 후 refetch된 메시지가 도착하면 web_stream 정리
  useEffect(() => {
    if (!web_stream?.done || web_stream.chat_id !== activeId) return;
    const last = raw_messages[raw_messages.length - 1];
    if (last?.direction === "assistant") set_web_stream(null);
  }, [raw_messages, web_stream, activeId, set_web_stream]);

  // 스트리밍 콘텐츠를 가상 메시지로 합쳐서 연속적 버블링
  const messages = (() => {
    if (!stream_active) return raw_messages;
    const virtual_msg: ChatMessage = {
      direction: "assistant",
      content: web_stream!.content,
      at: new Date().toISOString(),
    };
    return [...raw_messages, virtual_msg];
  })();

  const last_msg = messages.length > 0 ? messages[messages.length - 1] : null;
  const last_is_user = last_msg?.direction === "user";
  const has_active = !!activeId || is_mirror;
  const can_send = !sending && (is_mirror ? !!input.trim() : (!!input.trim() || pending_media.length > 0));
  /** sending + waiting_response: 전송~응답 시작 전까지 통합 로딩 상태 */
  const is_busy = sending || waiting_response;

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h2 className="chat-header__title">{t("chat.title")}</h2>
        <select
          className="chat-header__select"
          value={is_mirror ? "" : (activeId ?? "")}
          onChange={(e) => select_session(e.target.value || null)}
        >
          <option value="">{t("chat.select_session")}</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id.slice(0, 12)} · {t("chat.msgs_fmt", { count: s.message_count })} · {time_ago(s.created_at)}
            </option>
          ))}
        </select>
        {mirror_sessions.length > 0 && (
          <select
            className="chat-header__select"
            value={mirrorKey ?? ""}
            onChange={(e) => e.target.value ? select_mirror(e.target.value) : select_session(null)}
          >
            <option value="">{t("chat.mirror_select")}</option>
            {mirror_sessions.map((m) => (
              <option key={m.key} value={m.key}>
                {m.provider}:{m.alias || m.chat_id} · {m.message_count}msg
              </option>
            ))}
          </select>
        )}
        <button className="btn btn--sm btn--ok" disabled={creating} onClick={() => void create_session()}>
          {t("chat.new_session")}
        </button>
        {activeId && !is_mirror && (
          <button
            className="btn btn--xs btn--danger"
            disabled={deleting}
            onClick={() => setDeleteConfirmId(activeId)}
            aria-label={t("chat.delete_session")}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        )}
        {is_mirror && <Badge status={t("chat.mirror_badge")} variant="info" />}
        {pending_approvals.length > 0 && (
          <Badge status={`🔐 ${pending_approvals.length}`} variant="warn" />
        )}
      </div>

      {!has_active ? (
        <EmptyState onNewSession={create_session} />
      ) : (activeSessionLoading || mirrorSessionLoading) ? (
        <div className="chat-loading">
          <div className="spinner" aria-label={t("chat.loading")}></div>
          <p>{t("chat.loading")}</p>
        </div>
      ) : (
        <>
          {is_mirror && <div className="chat-mirror-hint">{t("chat.mirror_relay_hint")}</div>}
          <MessageList
            ref={messagesRef}
            messages={messages}
            sending={is_busy}
            last_is_user={last_is_user}
            is_streaming={is_streaming}
            pending_approvals={is_mirror ? [] : pending_approvals}
            onResolveApproval={(id, text) => void resolve_approval(id, text)}
          />
          <ChatPromptBar
            input={input}
            setInput={setInput}
            sending={is_busy}
            is_streaming={is_streaming}
            can_send={can_send}
            onSend={() => void (is_mirror ? send_mirror() : send())}
            pending_media={is_mirror ? [] : pending_media}
            onAttach={is_mirror ? undefined : () => fileInputRef.current?.click()}
            onRemoveMedia={is_mirror ? undefined : (idx: number) => setPendingMedia((prev) => prev.filter((_, i) => i !== idx))}
            selectedProvider={is_mirror ? undefined : selectedProvider}
            selectedModel={is_mirror ? undefined : selectedModel}
            onProviderChange={is_mirror ? undefined : setSelectedProvider}
            onModelChange={is_mirror ? undefined : setSelectedModel}
          />
          {!is_mirror && (
            <input
              type="file"
              ref={fileInputRef}
              onChange={handle_file}
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json"
              hidden
            />
          )}
        </>
      )}
      <DeleteConfirmModal
        open={!!deleteConfirmId}
        title={t("chat.delete_session_title")}
        message={t("chat.delete_session_confirm")}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => { if (deleteConfirmId) void delete_session(deleteConfirmId); setDeleteConfirmId(null); }}
        confirmLabel={t("common.delete")}
      />
    </div>
  );
}
