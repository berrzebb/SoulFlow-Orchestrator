import type { ReactNode } from "react";

export type EmptyStateType = "empty" | "loading" | "error" | "no-results";

/**
 * 빈 상태/로딩 상태 컴포넌트 — 명확한 상태 표시.
 *
 * 사용:
 * <EmptyState type="loading" title="데이터 로딩 중..." />
 * <EmptyState type="no-results" title="검색 결과가 없습니다" />
 */
export function EmptyState({
  type = "empty",
  title,
  description,
  icon,
  actions,
  className,
}: {
  type?: EmptyStateType;
  title: string;
  description?: ReactNode;
  icon?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const icons: Record<EmptyStateType, string> = {
    empty: "📭",
    loading: "⏳",
    error: "⚠️",
    "no-results": "🔍",
  };

  const defaultIcon = icon || icons[type];
  const ariaLabel = type === "loading" ? "로딩 중" : `${type} 상태`;

  return (
    <div className={`empty-state${className ? ` ${className}` : ""}`} role="status" aria-label={ariaLabel}>
      <div className="empty-state__icon" aria-hidden="true">
        {defaultIcon}
      </div>
      <p className="empty-state__text">{title}</p>
      {description && <p className="empty-state__hint">{description}</p>}
      {actions && <div className="empty-state__actions">{actions}</div>}
    </div>
  );
}
