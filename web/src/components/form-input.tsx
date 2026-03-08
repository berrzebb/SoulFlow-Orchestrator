import type { InputHTMLAttributes, ReactNode } from "react";
import { FormLabel } from "./form-label";

/**
 * 폼 입력 필드 컴포넌트 — 라벨, 에러 메시지, 힌트를 통합 관리.
 *
 * 사용:
 * <FormInput
 *   label="Email"
 *   type="email"
 *   value={email}
 *   onChange={setEmail}
 *   required
 *   error={emailError}
 *   hint="example@domain.com"
 * />
 */
export function FormInput({
  label,
  required,
  error,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  id?: string;
}) {
  const fieldId = id || `field-${Math.random().toString(36).slice(2, 9)}`;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="form-group">
      {label && <FormLabel label={label} required={required} />}
      <input
        id={fieldId}
        className={`form-input${error ? " form-input--error" : ""}`}
        aria-invalid={!!error}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        required={required}
        aria-required={required}
        {...props}
      />
      {error && <span id={errorId} className="field-error">{error}</span>}
      {hint && !error && <span id={hintId} className="form-hint">{hint}</span>}
    </div>
  );
}
