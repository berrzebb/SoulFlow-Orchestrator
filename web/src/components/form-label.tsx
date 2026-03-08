import type { ReactNode } from "react";

/**
 * 폼 라벨 컴포넌트 — 필수 필드 표시 자동화 + 입력 필드 연결.
 *
 * 사용:
 * <FormLabel label="Email" htmlFor="email-input" required />
 * <input id="email-input" type="email" />
 */
export function FormLabel({ label, required, htmlFor, children }: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children?: ReactNode;
}) {
  return (
    <label className="form-label" htmlFor={htmlFor}>
      {label}
      {required && <span aria-label="required" className="form-required">*</span>}
      {children}
    </label>
  );
}
