import { useRef, useEffect, forwardRef, type KeyboardEvent } from "react";

/**
 * 검색 입력 필드 — 아이콘, 검색어, 클리어 버튼 포함.
 *
 * 사용:
 * <SearchInput
 *   value={query}
 *   onChange={setQuery}
 *   placeholder="Search nodes..."
 *   onClear={() => setQuery("")}
 *   autoFocus
 * />
 *
 * ref 사용:
 * const inputRef = useRef<HTMLInputElement>(null);
 * <SearchInput ref={inputRef} ... />
 * inputRef.current?.focus();
 */
export interface SearchInputProps {
  /** 검색어 */
  value: string;
  /** 검색어 변경 핸들러 */
  onChange: (value: string) => void;
  /** 플레이스홀더 텍스트 */
  placeholder?: string;
  /** 클리어 버튼 클릭 핸들러 */
  onClear?: () => void;
  /** 비활성화 */
  disabled?: boolean;
  /** autoFocus 여부 */
  autoFocus?: boolean;
  /** ARIA label */
  ariaLabel?: string;
  /** 컨테이너 클래스명 */
  className?: string;
  /** 입력 클래스명 */
  inputClassName?: string;
  /** 검색 아이콘 표시 여부 */
  showIcon?: boolean;
  /** 아이콘 위치 ('left' | 'right') */
  iconPosition?: "left" | "right";
  /** 키보드 이벤트 핸들러 */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder = "Search...",
    onClear,
    disabled = false,
    autoFocus = false,
    ariaLabel,
    className = "",
    inputClassName = "",
    showIcon = true,
    iconPosition = "left",
    onKeyDown,
  },
  ref,
) {
  const internalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => {
        if (typeof ref === "function") {
          ref(internalRef.current);
        } else if (ref) {
          ref.current = internalRef.current;
        }
        internalRef.current?.focus();
      }, 50);
    }
  }, [autoFocus, ref]);

  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
    internalRef.current?.focus();
  };

  const icon = (
    <svg
      className="search-input__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );

  return (
    <div className={`search-input${className ? ` ${className}` : ""}`}>
      {showIcon && iconPosition === "left" && icon}
      <input
        ref={internalRef}
        className={`search-input__field${inputClassName ? ` ${inputClassName}` : ""}`}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      {value && (
        <button
          className="search-input__clear"
          onClick={handleClear}
          disabled={disabled}
          aria-label="Clear search"
          type="button"
        >
          ✕
        </button>
      )}
      {showIcon && iconPosition === "right" && icon}
    </div>
  );
});
