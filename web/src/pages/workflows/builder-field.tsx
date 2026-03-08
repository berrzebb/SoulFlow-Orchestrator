import type { ReactNode } from "react";
import { useT } from "../../i18n";

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
