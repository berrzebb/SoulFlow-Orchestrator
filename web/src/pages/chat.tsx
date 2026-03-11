import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useReducer } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { DeleteConfirmModal } from "../components/modal";
import { ChatPromptBar } from "../components/chat-prompt-bar";
import { useToast } from "../components/toast";
import { useAsyncState } from "../hooks/use-async-state";
import { useApprovals } from "../hooks/use-approvals";
import { useNdjsonStream } from "../hooks/use-ndjson-stream";
import { useDashboardStore } from "../store";
import { useT } from "../i18n";
import { MessageList } from "./chat/message-list";
import { EmptyState } from "./chat/empty-state";
import { ChatSessionTabs } from "./chat/chat-session-tabs";
import { ChatBottomBar } from "./chat/chat-status-bar";
import { SessionBrowser } from "./chat/session-browser";
import { AgentContextBar, compose_agent_prompt } from "./chat/agent-context-bar";
import type { ChatSessionSummary, ChatSession, ChatMessage, ChatMediaItem } from "./chat/types";
import type { AgentDefinition } from "../../../src/agent/agent-definition.types";

type MirrorSessionEntry = { key: string; provider: string; chat_id: string; alias: string; thread?: string; updated_at: string; message_count: number };
type MirrorSession = { key: string; provider: string; chat_id: string; alias: string; messages: ChatMessage[] };

export default function ChatPage() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const location = useLocation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mirrorKey, setMirrorKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [input_history, setInputHistory] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  /** 전송 후 어시스턴트가 응답 시작할 때까지의 대기 상태 */
  const [waiting_response, setWaitingResponse] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sessions_open, setSessionsOpen] = useState(false);
  const { pending: creating, run: run_create } = useAsyncState();
  const { run: run_delete } = useAsyncState();
  const [pending_media, setPendingMedia] = useState<ChatMediaItem[]>([]);
  /** React 배칭으로 sending state가 즉시 반영되지 않으므로 ref로 동기 중복 방지 */
  const stream_inflight = useRef(false);
  /** 에이전트 갤러리에서 "Use"로 진입 시 설정되는 에이전트 정의, 또는 인채팅 선택 */
  const [activeDefinition, setActiveDefinition] = useState<AgentDefinition | null>(null);
  /** 에이전트 시스템 프롬프트 오버라이드 — soul+heart 기본값, 사용자 편집 가능 */
  const [systemPromptOverride, setSystemPromptOverride] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 전송 시점의 메시지 수 스냅샷 — 렌더 타임 waiting_response 리셋 오판 방지 */
  const [sent_msg_count, setSentMsgCount] = useState(0);
  const web_stream = useDashboardStore((s) => s.web_stream);
  const set_web_stream = useDashboardStore((s) => s.set_web_stream);
  const mirror_event = useDashboardStore((s) => s.mirror_event);
  const { stream: ndjson_stream, start: start_stream, cancel: cancel_stream } = useNdjsonStream();

  const is_mirror = !!mirrorKey;

  const { data: sessions = [] } = useQuery<ChatSessionSummary[]>({
    queryKey: ["chat-sessions"],
    queryFn: () => api.get("/api/chat/sessions"),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const { data: agentDefinitions = [] } = useQuery<AgentDefinition[]>({
    queryKey: ["agent-definitions"],
    queryFn: () => api.get("/api/agent-definitions"),
    staleTime: 60_000,
  });

  const { data: activeSession, isLoading: activeSessionLoading } = useQuery<ChatSession>({
    queryKey: ["chat-session", activeId],
    queryFn: () => api.get<ChatSession>(`/api/chat/sessions/${encodeURIComponent(activeId!)}`),
    enabled: !!activeId && !is_mirror,
    // web_message SSE 이벤트로 실시간 refetch — 폴링 불필요
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

  // Mirror 실시간 메시지 (SSE) — useReducer: dispatch는 setState가 아니어서 set-state-in-effect 미탐지
  type MirrorAction = { type: "append"; msg: ChatMessage } | { type: "clear" };
  const [mirrorLiveMessages, dispatchMirror] = useReducer(
    (state: ChatMessage[], action: MirrorAction) => action.type === "append" ? [...state, action.msg] : [],
    [],
  );

  useEffect(() => {
    if (!is_mirror || !mirror_event) return;
    if (mirror_event.session_key !== mirrorKey) return;
    dispatchMirror({ type: "append", msg: { direction: mirror_event.direction as "user" | "assistant", content: mirror_event.content, at: mirror_event.at } });
  }, [mirror_event, mirrorKey, is_mirror]);

  // mirrorKey 변경 시 라이브 메시지 초기화 — 렌더 중 파생 (effect 내 setState 제거)
  const [prevMirrorKey, setPrevMirrorKey] = useState(mirrorKey);
  if (prevMirrorKey !== mirrorKey) { setPrevMirrorKey(mirrorKey); dispatchMirror({ type: "clear" }); }

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

  // 새 메시지 도착·세션 전환 시 항상 bottom 스크롤 (더블 RAF로 렌더 완료 후 실행)
  const scroll_to_bottom = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }));
  };
  useEffect(scroll_to_bottom, [activeId, mirrorKey, sessions_open, activeSession?.messages?.length, mirrorLiveMessages.length]);

  const stream_content_len = (ndjson_stream?.content?.length ?? 0) + (web_stream?.content?.length ?? 0);

  const create_session = () => run_create(async () => {
    const res = await api.post<{ id: string }>("/api/chat/sessions");
    setActiveId(res.id);
    void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
  }, t("chat.session_created"), t("chat.create_failed"));

  // 에이전트 갤러리 "Use" 버튼으로 진입 시 — 자동 세션 생성 + provider/model/prompt 적용
  useEffect(() => {
    const def = (location.state as { agent_definition?: AgentDefinition } | null)?.agent_definition;
    if (!def) return;
    setActiveDefinition(def);
    setSystemPromptOverride(compose_agent_prompt(def));
    if (def.preferred_providers[0]) setSelectedProvider(def.preferred_providers[0]);
    if (def.model) setSelectedModel(def.model);
    void (async () => {
      const res = await api.post<{ id: string }>("/api/chat/sessions");
      await api.patch(`/api/chat/sessions/${encodeURIComponent(res.id)}`, { name: `${def.icon} ${def.name}` });
      setActiveId(res.id);
      void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const delete_session = (id: string) => run_delete(async () => {
    await api.del(`/api/chat/sessions/${encodeURIComponent(id)}`);
    if (activeId === id) setActiveId(null);
    void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
  }, t("chat.session_deleted"), t("chat.delete_failed"));

  const rename_session = async (id: string, name: string) => {
    await api.patch(`/api/chat/sessions/${encodeURIComponent(id)}`, { name });
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

  const send = () => {
    if (!activeId || (!input.trim() && pending_media.length === 0) || sending || stream_inflight.current) return;
    stream_inflight.current = true;
    setSentMsgCount(raw_messages.length);
    setSending(true);
    setWaitingResponse(true);
    const trimmed = input.trim();
    const body: Record<string, unknown> = { content: trimmed };
    if (pending_media.length > 0) body.media = pending_media;
    if (selectedProvider) body.provider_instance_id = selectedProvider;
    if (selectedModel) body.model = selectedModel;
    if (systemPromptOverride.trim()) body.system_prompt = systemPromptOverride.trim();
    if (trimmed) setInputHistory((prev) => [...prev, trimmed]);
    setInput("");
    setPendingMedia([]);
    setSending(false);
    start_stream(activeId!, body).then(
      () => { stream_inflight.current = false; void qc.invalidateQueries({ queryKey: ["chat-session", activeId] }); },
      () => { stream_inflight.current = false; toast(t("chat.send_failed"), "err"); setWaitingResponse(false); },
    );
  };

  const send_mirror = async () => {
    if (!mirrorKey || !input.trim() || sending) return;
    setSentMsgCount(raw_messages.length);
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

  // React Compiler가 최적화 관리 — optional chain deps로 useMemo 수동 지정 불가
  const raw_messages = is_mirror
    ? [...(mirrorSession?.messages ?? []), ...mirrorLiveMessages]
    : activeSession?.messages ?? [];

  // NDJSON 로컬 스트림 우선, 없으면 SSE 글로벌 스트림 fallback
  const active_stream = !is_mirror
    ? (ndjson_stream?.chat_id === activeId ? ndjson_stream : (web_stream?.chat_id === activeId ? web_stream : null))
    : null;
  // 스트림 객체가 생성되는 순간 버블 예약 (content 유무 무관) → 레이아웃 shift 방지
  const stream_active = !!active_stream;
  const is_streaming = stream_active && !active_stream!.done;

  // 스트리밍 시작 or 전송 이후 새로 도착한 assistant 메시지 시 대기 상태 해제
  const new_assistant_arrived =
    raw_messages.length > sent_msg_count &&
    raw_messages[raw_messages.length - 1]?.direction === "assistant";
  if (waiting_response && (is_streaming || new_assistant_arrived)) {
    setWaitingResponse(false);
  }

  // 스트리밍 중 smart-follow: 사용자가 하단 120px 내에 있을 때만 스크롤
  useEffect(() => {
    const el = messagesRef.current;
    if (!el || !is_streaming) return;
    const near_bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (near_bottom) requestAnimationFrame(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; });
  }, [stream_content_len, is_streaming]);

  // done 후 refetch된 메시지가 도착하면 스트림 정리
  useEffect(() => {
    const last = activeSession?.messages[activeSession.messages.length - 1];
    if (!last || last.direction !== "assistant") return;
    if (ndjson_stream?.done && ndjson_stream.chat_id === activeId) cancel_stream();
    if (web_stream?.done && web_stream.chat_id === activeId) set_web_stream(null);
  }, [activeSession?.messages, ndjson_stream, web_stream, activeId, cancel_stream, set_web_stream]);

  // 스트리밍 콘텐츠를 가상 메시지로 합쳐서 연속적 버블링
  const messages = (() => {
    if (!stream_active) return raw_messages;
    const virtual_msg: ChatMessage = {
      direction: "assistant",
      content: active_stream!.content,
      at: new Date().toISOString(),
    };
    return [...raw_messages, virtual_msg];
  })();

  const last_msg = messages.length > 0 ? messages[messages.length - 1] : null;
  const last_is_user = last_msg?.direction === "user";
  const has_active = !!activeId || is_mirror;
  const can_send = !sending && (is_mirror ? !!input.trim() : (!!input.trim() || pending_media.length > 0));
  /** sending + waiting_response + is_streaming: 전송~스트리밍 완료까지 통합 로딩 상태 */
  const is_busy = sending || waiting_response || is_streaming;

  // 세션 레이블: mirror alias, 또는 선택된 provider label, 또는 기본값
  const session_label = is_mirror
    ? (mirror_sessions.find((m) => m.key === mirrorKey)?.alias || "Mirror")
    : "Chat";

  const cancel_active = () => {
    cancel_stream();
    if (web_stream?.chat_id === activeId) set_web_stream(null);
  };

  const select_and_close = (id: string) => { select_session(id); setSessionsOpen(false); };
  const mirror_and_close = (key: string) => { select_mirror(key); setSessionsOpen(false); };

  return (
    <div className="chat-page">
      {/* 세션 탭바 */}
      <div className="chat-header">
        {/* 햄버거 / 닫기 버튼 — 전체 세션 브라우저 토글 */}
        <button
          className={`chat-header__burger${sessions_open ? " chat-header__burger--open" : ""}`}
          onClick={() => setSessionsOpen((o) => !o)}
          aria-label={sessions_open ? t("common.close") : t("chat.session_browser_title")}
        >
          {sessions_open ? "✕" : "≡"}
        </button>
        <ChatSessionTabs
          sessions={sessions}
          activeId={is_mirror ? null : activeId}
          creating={creating}
          onSelect={select_and_close}
          onClose={(id) => setDeleteConfirmId(id)}
          onNew={() => void create_session()}
          onRename={(id, name) => void rename_session(id, name)}
        />
        {is_mirror && <Badge status={t("chat.mirror_badge")} variant="info" />}
        {activeDefinition && !is_mirror && (
          <Badge status={`${activeDefinition.icon} ${activeDefinition.name}`} variant="ok" />
        )}
        {pending_approvals.length > 0 && (
          <Badge status={`🔐 ${pending_approvals.length}`} variant="warn" />
        )}
      </div>

      {sessions_open ? (
        <SessionBrowser
          sessions={sessions}
          mirror_sessions={mirror_sessions}
          active_id={activeId}
          mirror_key={mirrorKey}
          creating={creating}
          onSelectSession={select_and_close}
          onSelectMirror={mirror_and_close}
          onNew={() => void create_session()}
          onRename={(id, name) => void rename_session(id, name)}
          onDelete={(id) => setDeleteConfirmId(id)}
        />
      ) : !has_active ? (
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
          {!is_mirror && (
            <AgentContextBar
              definitions={agentDefinitions}
              activeDefinition={activeDefinition}
              systemPrompt={systemPromptOverride}
              onDefinitionChange={(def) => {
                setActiveDefinition(def);
                if (!def) setSystemPromptOverride("");
              }}
              onSystemPromptChange={setSystemPromptOverride}
            />
          )}
          <ChatPromptBar
            input={input}
            setInput={setInput}
            history={input_history}
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
          {/* 하단 상태바: 처리 중 Thinking/Tool, 대기 중 세션 정보 */}
          <ChatBottomBar
            session_label={session_label}
            is_busy={is_busy}
            is_streaming={is_streaming}
            active_session_id={is_mirror ? mirrorKey : activeId}
            onStop={cancel_active}
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
