import type { ReactNode } from "react";

/** 토글 버튼으로 열고 닫는 콜랩서블 섹션. */
export function Collapsible({ open, onToggle, label, children, className, buttonClassName }: {
  open: boolean;
  onToggle: (open: boolean) => void;
  label: ReactNode;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
}) {
  return (
    <div className={className}>
      <button
        className={buttonClassName ?? "btn btn--sm toggle-btn"}
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        {open ? "▾" : "▸"} {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
