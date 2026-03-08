import type { InputHTMLAttributes } from "react";

/**
 * 체크박스 필드 컴포넌트 — 라벨 연결 자동화.
 *
 * 사용:
 * <CheckboxField
 *   id="enable-feature"
 *   label="기능 활성화"
 *   checked={enabled}
 *   onChange={setEnabled}
 * />
 */
export function CheckboxField({
  id,
  label,
  checked,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="checkbox-label">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        {...props}
      />
      {" "}{label}
    </label>
  );
}
