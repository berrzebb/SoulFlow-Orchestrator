/**
 * 채팅 입력 + 프로바이더/모델 선택을 통합한 프롬프트바.
 * - 텍스트 입력 (자동 높이 조절)
 * - 첨부 파일 버튼 (옵션)
 * - 모델 선택 칩 → 팝업 (옵션)
 */

import { useRef, useEffect, useState } from "react";
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
  can_send: boolean;
  onSend: () => void;
  placeholder?: string;

  /** 파일 첨부 지원 */
  pending_media?: ChatMediaItem[];
  onAttach?: () => void;
  onRemoveMedia?: (idx: number) => void;

  /** 프로바이더/모델 선택 지원 (선택사항) */
  selectedProvider?: string;
  selectedModel?: string;
  onProviderChange?: (id: string) => void;
  onModelChange?: (model: string) => void;

  className?: string;
}

export function ChatPromptBar(props: ChatPromptBarProps) {
  const t = useT();
  const textarea_ref = useRef<HTMLTextAreaElement>(null);
  const popup_ref = useRef<HTMLDivElement>(null);

  const has_model_selector = !!(props.onProviderChange && props.onModelChange);
  const [popup_open, setPopupOpen] = useState(false);
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading_instances, setLoadingInstances] = useState(false);
  const [loading_models, setLoadingModels] = useState(false);

  // 자동 높이 조절
  useEffect(() => {
    const el = textarea_ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [props.input]);

  // 팝업 외부 클릭 시 닫기
  useEffect(() => {
    if (!popup_open) return;
    const handler = (e: MouseEvent) => {
      if (popup_ref.current && !popup_ref.current.contains(e.target as Node)) {
        setPopupOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popup_open]);

  // 프로바이더 인스턴스 목록 로드
  useEffect(() => {
    if (!has_model_selector) return;
    let cancelled = false;
    setLoadingInstances(true);
    api
      .get<ProviderInstance[]>("/api/config/provider-instances?purpose=chat")
      .then((data) => { if (!cancelled) setInstances(data); })
      .catch(() => { if (!cancelled) setInstances([]); })
      .finally(() => { if (!cancelled) setLoadingInstances(false); });
    return () => { cancelled = true; };
  }, [has_model_selector]);

  // 프로바이더 선택 시 모델 목록 로드
  useEffect(() => {
    if (!has_model_selector || !props.selectedProvider) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    api
      .get<ModelInfo[]>(`/api/agents/providers/${encodeURIComponent(props.selectedProvider)}/models`)
      .then((data) => {
        if (!cancelled) {
          setModels(data);
          if (data.length > 0 && !data.find((m) => m.id === props.selectedModel)) {
            props.onModelChange?.(data[0].id);
          }
        }
      })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedProvider, has_model_selector]);

  const handle_key_down = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (props.can_send) props.onSend();
    }
  };

  const current_provider = instances.find((i) => i.instance_id === props.selectedProvider);
  const model_chip_label = props.selectedModel
    ? (models.find((m) => m.id === props.selectedModel)?.name ?? props.selectedModel)
    : (current_provider?.label ?? t("chat.model_auto"));

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
            disabled={props.sending}
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
          onChange={(e) => props.setInput(e.target.value)}
          onKeyDown={handle_key_down}
          placeholder={props.placeholder ?? t("chat.placeholder")}
          disabled={props.sending}
          rows={1}
        />

        {has_model_selector && (
          <div className="chat-prompt-bar__model-wrap" ref={popup_ref}>
            <button
              className="chat-prompt-bar__model-chip"
              onClick={() => setPopupOpen((v) => !v)}
              disabled={loading_instances}
              aria-label={t("chat.provider_select")}
              title={t("chat.provider_select")}
              type="button"
            >
              {model_chip_label}
              <span className="chat-prompt-bar__model-chip-caret">▾</span>
            </button>

            {popup_open && (
              <div className="chat-prompt-bar__model-popup">
                <div className="chat-prompt-bar__model-popup-row">
                  <label className="chat-prompt-bar__model-popup-label">{t("chat.provider_select")}</label>
                  <select
                    className="input input--sm"
                    value={props.selectedProvider}
                    onChange={(e) => { props.onProviderChange?.(e.target.value); }}
                    disabled={loading_instances}
                  >
                    <option value="">{t("chat.model_auto")}</option>
                    {instances.map((inst) => (
                      <option key={inst.instance_id} value={inst.instance_id}>
                        {inst.label}
                      </option>
                    ))}
                  </select>
                </div>

                {props.selectedProvider && (
                  <div className="chat-prompt-bar__model-popup-row">
                    <label className="chat-prompt-bar__model-popup-label">{t("chat.model_select")}</label>
                    <select
                      className="input input--sm"
                      value={props.selectedModel}
                      onChange={(e) => props.onModelChange?.(e.target.value)}
                      disabled={loading_models || models.length === 0}
                    >
                      {models.length === 0 ? (
                        <option value="">{t("chat.model_loading")}</option>
                      ) : (
                        models.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))
                      )}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <button
          className={`chat-prompt-bar__btn${props.can_send ? " chat-prompt-bar__btn--send" : ""}`}
          onClick={props.onSend}
          disabled={!props.can_send}
          aria-label={t("common.send")}
        >
          {props.sending ? "…" : "↑"}
        </button>
      </div>

      <div className="chat-prompt-bar__hint text-xs text-muted">
        Enter {t("chat.send_hint")} · Shift+Enter {t("chat.newline_hint")}
      </div>
    </div>
  );
}
