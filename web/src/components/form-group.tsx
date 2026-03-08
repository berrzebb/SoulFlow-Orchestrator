import { ReactNode } from "react";
import { FormLabel } from "./form-label";

/**
 * Form 필드 그룹 — label, input, error, hint를 통합 관리.
 *
 * 용도:
 * - 폼 필드의 구조 표준화 (form-group + label + input + error/hint)
 * - 에러/힌트 자동 표시
 * - 접근성 개선 (aria-describedby 자동 지정)
 *
 * 사용:
 * <FormGroup label="Email" required error={emailError}>
 *   <input className="form-input" type="email" value={email} onChange={setEmail} />
 * </FormGroup>
 *
 * 또는 FormInput과 함께:
 * <FormGroup label="Name" required>
 *   <FormInput type="text" value={name} onChange={setName} />
 * </FormGroup>
 */
export function FormGroup({
  label,
  required,
  error,
  hint,
  children,
}: {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const fieldId = `field-${Math.random().toString(36).slice(2, 9)}`;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="form-group">
      {label && <FormLabel label={label} required={required} htmlFor={fieldId} />}

      {/* 자식 input/select/textarea에 aria-describedby 주입하려면
          개별적으로 처리 필요. 여기서는 wrapper만 제공. */}
      <div
        data-aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
      >
        {children}
      </div>

      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={hintId} className="form-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
