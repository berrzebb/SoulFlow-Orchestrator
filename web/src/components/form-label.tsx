import type { ReactNode } from "react";

/**
 * 폼 라벨 컴포넌트 — 필수 필드 표시 자동화.
 *
 * 사용:
 * <FormLabel label="Email" required />
 * <FormLabel label="Description" />
 */
export function FormLabel({ label, required, children }: {
  label: string;
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <label className="form-label">
      {label}
      {required && <span aria-label="required" className="form-required">*</span>}
      {children}
    </label>
  );
}
