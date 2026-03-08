import type { ReactNode } from "react";
import { FormLabel } from "./form-label";

/** form 필드 컨테이너 — label + input + hint/error 표준화. */
export function FormGroup({ label, required, hint, error, children, className }: {
  label?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`form-group${className ? ` ${className}` : ""}`}>
      {label && <FormLabel label={label} required={required} />}
      {children}
      {hint && !error && <span className="form-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}
