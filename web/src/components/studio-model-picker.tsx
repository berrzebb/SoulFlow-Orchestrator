/**
 * Prompting Studio 모델 선택기.
 * provider pill + model dropdown 인라인 배치 (AI Studio 스타일).
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

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

export function StudioModelPicker({ value, onChange, purpose, hideModel, compact, onCompare }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const { data: providers = [] } = useQuery<ProviderInfo[]>({
    queryKey: ["studio-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    staleTime: 30_000,
  });

  const available = providers.filter((p) => p.available !== false);
  const sel_prov = available.find((p) => p.instance_id === value.provider_id);
  const icon = sel_prov ? prov_icon(sel_prov.provider_type) : "○";

  useEffect(() => {
    if (!value.provider_id) { setModels([]); return; }
    setLoadingModels(true);
    api.get<ModelInfo[]>(`/api/agents/providers/${encodeURIComponent(value.provider_id)}/models`)
      .then((list) => {
        const filtered = purpose
          ? list.filter((m) => m.purpose === purpose)
          : list.filter((m) => m.purpose !== "embedding");
        setModels(filtered);
      })
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [value.provider_id, purpose]);

  /* compact 모드 — 기존 호환 */
  if (compact) {
    const cls = "input input--sm";
    return (
      <div className="studio-model-picker">
        <select className={cls} value={value.provider_id}
          onChange={(e) => onChange({ provider_id: e.target.value, model: "" })} aria-label="Provider">
          <option value="">— Provider —</option>
          {available.map((p) => (
            <option key={p.instance_id} value={p.instance_id}>
              {p.circuit_state === "open" ? "⚫ " : "🟢 "}{p.label}
            </option>
          ))}
        </select>
        {!hideModel && (
          loadingModels
            ? <input className={cls} disabled placeholder="loading…" />
            : models.length > 0
              ? <select className={cls} value={value.model}
                  onChange={(e) => onChange({ ...value, model: e.target.value })} aria-label="Model">
                  <option value="">auto</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              : <input className={cls} value={value.model}
                  onChange={(e) => onChange({ ...value, model: e.target.value })}
                  placeholder="model (optional)" aria-label="Model" />
        )}
      </div>
    );
  }

  /* 풀 모드 — ps-model-bar: [provider pill] [model select ▼] [Compare] */
  return (
    <div className="ps-model-bar">
      {/* Provider pill: 아이콘 + provider select */}
      <div className="ps-model-bar__pill" style={{ overflow: "hidden", gap: 0, paddingRight: 0 }}>
        <span style={{ paddingLeft: 10, fontSize: 14, flexShrink: 0, pointerEvents: "none" }}>{icon}</span>
        <select
          style={{
            border: "none", background: "transparent", fontSize: 12, fontWeight: 600,
            color: "inherit", cursor: "pointer", padding: "0 24px 0 6px", height: "100%",
            appearance: "none",
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2391a4b7' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
            backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
          }}
          value={value.provider_id}
          onChange={(e) => onChange({ provider_id: e.target.value, model: "" })}
          aria-label="Provider"
        >
          {!value.provider_id && <option value="">— Provider —</option>}
          {available.map((p) => (
            <option key={p.instance_id} value={p.instance_id}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* 선택된 provider icon — pill 앞 장식 */}
      {!hideModel && (
        loadingModels
          ? <select className="ps-model-bar__select" disabled aria-label="Model">
              <option>loading…</option>
            </select>
          : models.length > 0
            ? <select
                className="ps-model-bar__select"
                value={value.model}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
                aria-label="Model"
              >
                <option value="">auto</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            : <input
                className="ps-model-bar__select"
                value={value.model}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
                placeholder="model (optional)"
                aria-label="Model"
              />
      )}

      {onCompare && (
        <button className="ps-model-bar__compare" type="button" onClick={onCompare}>
          Compare
        </button>
      )}
    </div>
  );
}
