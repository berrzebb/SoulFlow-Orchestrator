import type { ReactNode } from "react";

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
