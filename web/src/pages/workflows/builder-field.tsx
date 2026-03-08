import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { useProviderModels } from "./use-provider-models";
import { useJsonField } from "./use-json-field";
import type { NodeOptions } from "./node-registry";

/** 워크플로우 빌더 폼 필드 — label + input + hint/error 표준화. */
export function BuilderField({ label, required, optional, hint, error, children }: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="builder-row">
      <label className="label">
        {label}
        {required && <span className="label__required">*</span>}
        {optional && <span className="label__optional">(optional)</span>}
      </label>
      {children}
      {hint && !error && <span className="builder-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

/** 2개 필드를 나란히 배치하는 빌더 행 쌍. */
export function BuilderRowPair({ children, className }: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`builder-row-pair${className ? ` ${className}` : ""}`}>{children}</div>;
}

/** LLM backend + model 선택기 — useProviderModels 훅 내장, 로딩/fallback 처리 포함. */
export function BackendModelPicker({ backend, onBackendChange, model, onModelChange, options, required, autoFocus, backendLabel, modelLabel }: {
  backend: string;
  onBackendChange: (v: string) => void;
  model: string | undefined;
  onModelChange: (v: string | undefined) => void;
  options?: NodeOptions;
  required?: boolean;
  autoFocus?: boolean;
  backendLabel: string;
  modelLabel: string;
}) {
  const { models, loading } = useProviderModels(backend, options);
  return (
    <BuilderRowPair>
      <BuilderField label={backendLabel} required={required}>
        <select autoFocus={autoFocus} className="input input--sm" required={required} value={backend}
          onChange={(e) => onBackendChange(e.target.value)} aria-required={required || undefined}>
          <option value="">-</option>
          {(options?.backends || []).map((b) => (
            <option key={b.value} value={b.value}>
              {b.available === false ? "\u26AA " : "\uD83D\uDFE2 "}{b.label}{b.provider_type ? ` (${b.provider_type})` : ""}
            </option>
          ))}
        </select>
      </BuilderField>
      <BuilderField label={modelLabel} required={required}>
        {loading ? (
          <input className="input input--sm" disabled aria-busy="true" placeholder="loading..." />
        ) : models.length > 0 ? (
          <select className="input input--sm" value={model || ""} onChange={(e) => onModelChange(e.target.value || undefined)}>
            <option value="">auto</option>
            {models.filter((m) => m.purpose !== "embedding").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        ) : (
          <input className="input input--sm" value={model || ""} onChange={(e) => onModelChange(e.target.value || undefined)} placeholder="auto" />
        )}
      </BuilderField>
    </BuilderRowPair>
  );
}

/** JSON textarea — raw text + 파싱 에러 표시 통합. label/rows/placeholder/emptyValue 설정 가능. */
export function JsonField({ label, value, onUpdate, rows = 3, placeholder, small, hint, autoFocus, emptyValue = undefined }: {
  label: string;
  value: unknown;
  onUpdate: (parsed: unknown) => void;
  rows?: number;
  placeholder?: string;
  small?: boolean;
  hint?: ReactNode;
  autoFocus?: boolean;
  emptyValue?: unknown;
}) {
  const { raw, err, onChange } = useJsonField(value, onUpdate, emptyValue);
  return (
    <BuilderField label={label} hint={hint} error={err}>
      <textarea
        autoFocus={autoFocus}
        className={`input${small ? " input--sm" : ""} code-textarea${err ? " input--err" : ""}`}
        rows={rows}
        value={raw}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
      />
    </BuilderField>
  );
}

/** LLM temperature 슬라이더 — label 내부 상태 표시(precise/balanced/creative) 포함. */
export function TemperatureField({ value, onChange }: {
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const t = useT();
  const temp = value;
  return (
    <div className="builder-row">
      <label className="label">
        {t("workflows.llm_temperature")}
        <span className="builder-hint--inline">
          {temp == null ? "" : ` (${temp <= 0.3 ? t("workflows.temp_precise") : temp <= 0.7 ? t("workflows.temp_balanced") : t("workflows.temp_creative")})`}
        </span>
      </label>
      <input className="input input--sm" type="range" min={0} max={2} step={0.1} value={String(temp ?? 0.7)} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="builder-hint">{temp ?? 0.7}</span>
    </div>
  );
}
