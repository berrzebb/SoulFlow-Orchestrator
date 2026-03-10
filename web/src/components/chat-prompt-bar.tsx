/**
 * 채팅 입력 + 프로바이더/모델 선택을 통합한 프롬프트바.
 * - 텍스트 입력 (자동 높이 조절)
 * - 첨부 파일 버튼 (옵션)
 * - 프로바이더/모델 칩 → 개별 피커 팝업 (옵션)
 * - popupPlacement: 'up'(기본, 채팅 하단) | 'down'(워크플로우 상단)
 */

import { useRef, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useT } from "../i18n";
import { MediaPreviewBar } from "../pages/chat/media-preview";
import type { ChatMediaItem } from "../pages/chat/types";

interface ProviderInstance {
  instance_id: string;
  label: string;
}

interface ModelInfo {
  id: string;
  name: string;
}

export interface ChatPromptBarProps {
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  /** AI 응답 스트리밍 중 여부 — true이면 전송 버튼이 로딩 상태 유지 */
  is_streaming?: boolean;
  can_send: boolean;
  onSend: () => void;
  placeholder?: string;
  /** 이전 전송 메시지 히스토리 (오래된 순). ↑↓ 키 탐색에 사용. */
  history?: string[];

  /** 파일 첨부 지원 */
  pending_media?: ChatMediaItem[];
  onAttach?: () => void;
  onRemoveMedia?: (idx: number) => void;

  /** 프로바이더/모델 선택 지원 (선택사항) */
  selectedProvider?: string;
  selectedModel?: string;
  onProviderChange?: (id: string) => void;
  onModelChange?: (model: string) => void;

  /** 팝업 방향 — 'up': 위(기본, 채팅 하단), 'down': 아래(워크플로우 상단) */
  popupPlacement?: "up" | "down";

  className?: string;
}

type PickerKind = "provider" | "model" | null;

export function ChatPromptBar(props: ChatPromptBarProps) {
  const t = useT();
  const { popupPlacement = "up" } = props;
  const is_busy = props.sending || !!props.is_streaming;
  const textarea_ref = useRef<HTMLTextAreaElement>(null);
  const popup_ref = useRef<HTMLDivElement>(null);

  const has_model_selector = !!(props.onProviderChange && props.onModelChange);
  const [open_picker, setOpenPicker] = useState<PickerKind>(null);

  // 자동 높이 조절
  useEffect(() => {
    const el = textarea_ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [props.input]);

  // is_busy 해제 시 포커스 복원 (disabled 전환으로 인한 포커스 손실 방지)
  const prev_busy = useRef(false);
  useEffect(() => {
    if (prev_busy.current && !is_busy) textarea_ref.current?.focus();
    prev_busy.current = is_busy;
  }, [is_busy]);

  // 팝업 외부 클릭 시 닫기
  useEffect(() => {
    if (!open_picker) return;
    const handler = (e: MouseEvent) => {
      if (popup_ref.current && !popup_ref.current.contains(e.target as Node)) {
        setOpenPicker(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open_picker]);

  const { data: instances = [], isLoading: loading_instances } = useQuery({
    queryKey: ["provider-instances-chat"],
    queryFn: () => api.get<ProviderInstance[]>("/api/config/provider-instances?purpose=chat"),
    enabled: has_model_selector,
    staleTime: 60_000,
  });

  const { data: models = [], isLoading: loading_models } = useQuery({
    queryKey: ["provider-models", props.selectedProvider],
    queryFn: () => api.get<ModelInfo[]>(`/api/agents/providers/${encodeURIComponent(props.selectedProvider!)}/models`),
    enabled: has_model_selector && !!props.selectedProvider,
    staleTime: 60_000,
  });

  // 모델 목록 로드 후 첫 번째 모델 기본 선택
  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.id === props.selectedModel)) {
      props.onModelChange?.(models[0]!.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  /** 히스토리 탐색 상태. -1 = 현재 입력 중, 0 = 마지막 전송, 1 = 그 이전, ... */
  const history_cursor = useRef(-1);
  /** 히스토리 탐색 시작 전 작성 중이던 draft 보존 */
  const history_draft = useRef("");

  // 히스토리 변경 시 커서 초기화 (세션 전환 등)
  const history = props.history ?? [];

  const handle_key_down = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (props.can_send) {
        history_cursor.current = -1;
        props.onSend();
      }
      return;
    }

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && history.length > 0) {
      const el = e.currentTarget;
      const at_start = el.selectionStart === 0 && el.selectionEnd === 0;
      const at_end = el.selectionStart === el.value.length;

      if (e.key === "ArrowUp" && at_start) {
        e.preventDefault();
        if (history_cursor.current === -1) history_draft.current = props.input;
        const next = Math.min(history_cursor.current + 1, history.length - 1);
        history_cursor.current = next;
        props.setInput(history[history.length - 1 - next]!);
        return;
      }

      if (e.key === "ArrowDown" && at_end && history_cursor.current >= 0) {
        e.preventDefault();
        const next = history_cursor.current - 1;
        history_cursor.current = next;
        props.setInput(next === -1 ? history_draft.current : history[history.length - 1 - next]!);
        return;
      }
    }
  };

  const toggle_picker = (kind: PickerKind) =>
    setOpenPicker((prev) => (prev === kind ? null : kind));

  const select_provider = (id: string) => {
    props.onProviderChange?.(id);
    props.onModelChange?.("");
    setOpenPicker(null);
  };

  const select_model = (id: string) => {
    props.onModelChange?.(id);
    setOpenPicker(null);
  };

  const current_provider = instances.find((i) => i.instance_id === props.selectedProvider);
  const current_model = models.find((m) => m.id === props.selectedModel);

  return (
    <div className={`chat-prompt-bar${props.className ? ` ${props.className}` : ""}`}>
      {(props.pending_media?.length ?? 0) > 0 && props.onRemoveMedia && (
        <MediaPreviewBar items={props.pending_media!} onRemove={props.onRemoveMedia} />
      )}

      <div className="chat-prompt-bar__pill">
        {props.onAttach && (
          <button
            className="chat-prompt-bar__btn"
            onClick={props.onAttach}
            disabled={is_busy}
            title={t("chat.attach_file")}
            aria-label={t("chat.attach_file")}
          >
            +
          </button>
        )}

        <textarea
          ref={textarea_ref}
          autoFocus
          className="chat-prompt-bar__textarea"
          value={props.input}
          onChange={(e) => { history_cursor.current = -1; props.setInput(e.target.value); }}
          onKeyDown={handle_key_down}
          placeholder={props.placeholder ?? t("chat.placeholder")}
          disabled={is_busy}
          rows={1}
        />

        {has_model_selector && (
          <div className="chat-prompt-bar__model-wrap" ref={popup_ref}>
            {/* 프로바이더 칩 */}
            <button
              className={`chat-prompt-bar__model-chip${open_picker === "provider" ? " chat-prompt-bar__model-chip--active" : ""}`}
              onClick={() => toggle_picker("provider")}
              disabled={loading_instances}
              type="button"
              aria-label={t("chat.provider_select")}
              title={current_provider?.label ?? t("chat.model_auto")}
            >
              <span className="chat-prompt-bar__chip-text">
                {current_provider?.label ?? t("chat.model_auto")}
              </span>
              <span className="chat-prompt-bar__model-chip-caret">▾</span>
            </button>

            {/* 모델 칩 — 프로바이더 선택 시에만 표시 */}
            {props.selectedProvider && (
              <button
                className={`chat-prompt-bar__model-chip${open_picker === "model" ? " chat-prompt-bar__model-chip--active" : ""}`}
                onClick={() => toggle_picker("model")}
                disabled={loading_models}
                type="button"
                aria-label={t("chat.model_select")}
                title={current_model?.name ?? t("chat.model_auto")}
              >
                <span className="chat-prompt-bar__chip-text">
                  {current_model?.name ?? (loading_models ? "…" : t("chat.model_auto"))}
                </span>
                <span className="chat-prompt-bar__model-chip-caret">▾</span>
              </button>
            )}

            {/* 피커 팝업 */}
            {open_picker && (
              <div className={`chat-prompt-bar__model-popup chat-prompt-bar__model-popup--${popupPlacement}`}>
                <div className="chat-prompt-bar__model-popup-label">
                  {open_picker === "provider" ? t("chat.provider_select") : t("chat.model_select")}
                </div>
                <div className="chat-prompt-bar__picker-list">
                  {open_picker === "provider" ? (
                    <>
                      <button
                        type="button"
                        className={`chat-prompt-bar__picker-item${!props.selectedProvider ? " chat-prompt-bar__picker-item--selected" : ""}`}
                        onClick={() => select_provider("")}
                      >
                        {t("chat.model_auto")}
                      </button>
                      {instances.map((inst) => (
                        <button
                          key={inst.instance_id}
                          type="button"
                          className={`chat-prompt-bar__picker-item${props.selectedProvider === inst.instance_id ? " chat-prompt-bar__picker-item--selected" : ""}`}
                          onClick={() => select_provider(inst.instance_id)}
                        >
                          {inst.label}
                        </button>
                      ))}
                    </>
                  ) : loading_models ? (
                    <div className="chat-prompt-bar__picker-empty">…</div>
                  ) : models.length === 0 ? (
                    <div className="chat-prompt-bar__picker-empty">{t("chat.model_loading")}</div>
                  ) : (
                    models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`chat-prompt-bar__picker-item${props.selectedModel === m.id ? " chat-prompt-bar__picker-item--selected" : ""}`}
                        onClick={() => select_model(m.id)}
                      >
                        {m.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          className={`chat-prompt-bar__btn${is_busy ? " chat-prompt-bar__btn--loading" : props.can_send ? " chat-prompt-bar__btn--send" : ""}`}
          onClick={is_busy ? undefined : props.onSend}
          disabled={is_busy || !props.can_send}
          aria-label={is_busy ? t("chat.sending") : t("common.send")}
          aria-busy={is_busy}
        >
          {is_busy ? (
            <>
              <span className="chat-send-dot" />
              <span className="chat-send-dot" />
              <span className="chat-send-dot" />
            </>
          ) : "↑"}
        </button>
      </div>

      {!open_picker && (
        <div className="chat-prompt-bar__hint text-xs text-muted">
          Enter {t("chat.send_hint")} · Shift+Enter {t("chat.newline_hint")}
        </div>
      )}
    </div>
  );
}
