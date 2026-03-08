import { useRef, useEffect, ReactNode } from "react";

/**
 * 범용 입력 바 — 텍스트 입력 + 버튼(s) 기본 패턴.
 *
 * 사용:
 * <InputBar
 *   value={input}
 *   onChange={setInput}
 *   onSubmit={handleSend}
 *   submitLabel="Send"
 *   placeholder="Type message..."
 * />
 *
 * 또는 커스텀 버튼과:
 * <InputBar
 *   value={input}
 *   onChange={setInput}
 *   placeholder="Search..."
 *   buttons={[
 *     { label: "Search", onClick: () => search(input), disabled: !input }
 *   ]}
 * />
 */
export interface InputBarButton {
  label: string | ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "accent" | "danger";
  className?: string;
}

export interface InputBarProps {
  /** 입력값 */
  value: string;
  /** 입력 변경 핸들러 */
  onChange: (value: string) => void;
  /** 플레이스홀더 텍스트 */
  placeholder?: string;
  /** 비활성화 상태 */
  disabled?: boolean;
  /** autoFocus 여부 */
  autoFocus?: boolean;
  /** ARIA label */
  ariaLabel?: string;

  // 기본 submit 버튼 (선택)
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitVariant?: InputBarButton["variant"];

  // 커스텀 버튼들
  buttons?: InputBarButton[];
  onCancel?: () => void;

  // 스타일링
  className?: string;
  inputClassName?: string;
  containerClassName?: string;

  // 특수 기능
  multiline?: boolean; // textarea 사용 여부
  loading?: boolean; // 로딩 상태 (disable 적용)
  showShimmer?: boolean; // 로딩 shimmer 효과
  onKeyDown?: (e: React.KeyboardEvent) => void;
  hint?: ReactNode; // 입력 아래 힌트 텍스트

  // Textarea 높이 자동 조절 (multiline=true일 때만 작동)
  autoHeightMax?: number; // 최대 높이 (px)
}

export function InputBar({
  value,
  onChange,
  placeholder = "",
  disabled = false,
  autoFocus = false,
  ariaLabel,
  onSubmit,
  submitLabel = "Send",
  submitDisabled = false,
  submitVariant = "primary",
  buttons = [],
  onCancel,
  className = "",
  inputClassName = "",
  containerClassName = "",
  multiline = false,
  loading = false,
  showShimmer = false,
  onKeyDown,
  hint,
  autoHeightMax = 160,
}: InputBarProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Textarea 높이 자동 조절
  useEffect(() => {
    if (!multiline) return;
    const el = inputRef.current as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, autoHeightMax) + "px";
  }, [value, multiline, autoHeightMax]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onKeyDown) {
      onKeyDown(e);
      return;
    }
    // 기본: Enter만으로 submit (shift+enter는 multiline에서 줄바꿈)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (onSubmit && !submitDisabled && !disabled) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  const isDisabled = disabled || loading;
  const hasSubmit = !!onSubmit;
  const allButtons: InputBarButton[] = [];
  if (hasSubmit) {
    allButtons.push({
      label: submitLabel,
      onClick: onSubmit,
      disabled: submitDisabled || isDisabled,
      variant: submitVariant,
    });
  }
  allButtons.push(...buttons);

  return (
    <div className={`input-bar${className ? ` ${className}` : ""}`}>
      {showShimmer && <div className="input-bar__shimmer" />}
      <div className={`input-bar__container${containerClassName ? ` ${containerClassName}` : ""}`}>
        {multiline ? (
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            autoFocus={autoFocus}
            className={`input-bar__input input-bar__input--textarea${inputClassName ? ` ${inputClassName}` : ""}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isDisabled}
            aria-label={ariaLabel}
            rows={1}
          />
        ) : (
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            autoFocus={autoFocus}
            className={`input-bar__input${inputClassName ? ` ${inputClassName}` : ""}`}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isDisabled}
            aria-label={ariaLabel}
          />
        )}
        {allButtons.length > 0 && (
          <div className="input-bar__buttons">
            {allButtons.map((btn, idx) => (
              <button
                key={idx}
                className={`btn btn--sm${btn.variant === "accent" ? " btn--accent" : btn.variant === "danger" ? " btn--danger" : " btn--primary"}${
                  btn.className ? ` ${btn.className}` : ""
                }`}
                onClick={btn.onClick}
                disabled={btn.disabled}
                aria-label={typeof btn.label === "string" ? btn.label : undefined}
              >
                {btn.label}
              </button>
            ))}
            {onCancel && (
              <button className="btn btn--sm" onClick={onCancel} disabled={isDisabled} aria-label="Cancel">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
      {hint && <div className="input-bar__hint text-xs text-muted">{hint}</div>}
    </div>
  );
}
