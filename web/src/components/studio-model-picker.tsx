/**
 * Prompting Studio 모델 선택기.
 * provider pill(커스텀 드롭다운) + model dropdown 인라인 배치 (AI Studio 스타일).
 */
import { useState, useRef } from "react";
import { useClickOutside } from "../hooks/use-click-outside";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useT } from "../i18n";

interface ProviderInfo {
  instance_id: string;
  label: string;
  provider_type: string;
  available: boolean;
  circuit_state: string;
}

interface ModelInfo {
  id: string;
  name: string;
  purpose: string;
}

export interface StudioModelValue {
  provider_id: string;
  model: string;
}

interface Props {
  value: StudioModelValue;
  onChange: (v: StudioModelValue) => void;
  /** 특정 purpose 모델만 표시 ("image" | "video"). 미지정 = embedding 제외 전체 */
  purpose?: string;
  hideModel?: boolean;
  compact?: boolean;
  /** Compare 버튼 (클릭 콜백 제공 시 표시) */
  onCompare?: () => void;
}

const PROVIDER_INITIAL: Record<string, string> = {
  openai:     "⬡",
  anthropic:  "◈",
  google:     "✦",
  cohere:     "◉",
  mistral:    "▲",
  openrouter: "⊕",
};

function prov_icon(type: string): string {
  const t = type.toLowerCase();
  for (const [k, v] of Object.entries(PROVIDER_INITIAL)) {
    if (t.includes(k)) return v;
  }
  return "○";
}

/** Provider 커스텀 드롭다운 (네이티브 select 대체) */
function ProviderDropdown({
  providers,
  value,
  onChange,
}: {
  providers: ProviderInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap_ref = useRef<HTMLDivElement>(null);
  const sel = providers.find((p) => p.instance_id === value);

  useClickOutside(wrap_ref, () => setOpen(false), open);

  return (
    <div className="ps-prov-wrap" ref={wrap_ref}>
      <button
        type="button"
        className={`ps-model-bar__pill ps-prov-trigger${open ? " ps-prov-trigger--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("providers.select_provider")}
      >
        <span className="ps-prov-trigger__icon">
          {sel ? prov_icon(sel.provider_type) : "○"}
        </span>
        <span className="ps-prov-trigger__label">
          {sel ? sel.label : t("providers.select_provider")}
        </span>
        <svg
          className={`ps-prov-trigger__chevron${open ? " ps-prov-trigger__chevron--open" : ""}`}
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="ps-prov-dropdown" role="listbox" aria-label={t("providers.select_provider")}>
          {providers.length === 0 && (
            <div className="ps-prov-dropdown__empty">{t("providers.no_providers")}</div>
          )}
          {providers.map((p) => {
            const is_active = p.instance_id === value;
            const is_err = p.circuit_state === "open";
            return (
              <div
                key={p.instance_id}
                className={`ps-prov-dropdown__item${is_active ? " ps-prov-dropdown__item--sel" : ""}`}
                role="option"
                aria-selected={is_active}
                onClick={() => { onChange(p.instance_id); setOpen(false); }}
              >
                <span className="ps-prov-dropdown__icon">{prov_icon(p.provider_type)}</span>
                <span className="ps-prov-dropdown__label">{p.label}</span>
                <span className={`ps-prov-dropdown__dot${is_err ? " ps-prov-dropdown__dot--err" : " ps-prov-dropdown__dot--ok"}`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StudioModelPicker({ value, onChange, purpose, hideModel, compact, onCompare }: Props) {
  const t = useT();
  const { data: providers = [] } = useQuery<ProviderInfo[]>({
    queryKey: ["studio-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    staleTime: 30_000,
  });

  const { data: all_models = [], isLoading: loadingModels } = useQuery<ModelInfo[]>({
    queryKey: ["studio-models", value.provider_id],
    queryFn: () => api.get<ModelInfo[]>(`/api/agents/providers/${encodeURIComponent(value.provider_id)}/models`),
    enabled: !!value.provider_id,
    staleTime: 30_000,
  });

  const available = providers.filter((p) => p.available !== false);
  const models = purpose
    ? all_models.filter((m) => m.purpose === purpose)
    : all_models.filter((m) => m.purpose !== "embedding");

  /* compact 모드 — 기존 호환 */
  if (compact) {
    const cls = "input input--sm";
    return (
      <div className="studio-model-picker">
        <select className={cls} value={value.provider_id}
          onChange={(e) => onChange({ provider_id: e.target.value, model: "" })} aria-label="Provider">
          <option value="">{t("providers.select_provider")}</option>
          {available.map((p) => (
            <option key={p.instance_id} value={p.instance_id}>
              {p.circuit_state === "open" ? "⚫ " : "🟢 "}{p.label}
            </option>
          ))}
        </select>
        {!hideModel && (
          loadingModels
            ? <input className={cls} disabled placeholder={t("common.loading")} />
            : models.length > 0
              ? <select className={cls} value={value.model}
                  onChange={(e) => onChange({ ...value, model: e.target.value })} aria-label="Model">
                  <option value="">{t("providers.model_auto")}</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              : <input className={cls} value={value.model}
                  onChange={(e) => onChange({ ...value, model: e.target.value })}
                  placeholder={t("providers.model_input_placeholder")} aria-label="Model" />
        )}
      </div>
    );
  }

  /* 풀 모드 — [커스텀 provider pill] [model select ▼] [Compare] */
  return (
    <div className="ps-model-bar">
      <ProviderDropdown
        providers={available}
        value={value.provider_id}
        onChange={(id) => onChange({ provider_id: id, model: "" })}
      />

      {!hideModel && (
        loadingModels
          ? <select className="ps-model-bar__select" disabled aria-label="Model">
              <option>{t("common.loading")}</option>
            </select>
          : models.length > 0
            ? <select
                className="ps-model-bar__select"
                value={value.model}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
                aria-label="Model"
              >
                <option value="">{t("providers.model_auto")}</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            : <input
                className="ps-model-bar__select"
                value={value.model}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
                placeholder={t("providers.model_input_placeholder")}
                aria-label="Model"
              />
      )}

      {onCompare && (
        <button className="ps-model-bar__compare" type="button" onClick={onCompare}>
          {t("prompting.compare_title")}
        </button>
      )}
    </div>
  );
}
