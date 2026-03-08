import type { CSSProperties } from "react";

/** 로딩 상태용 스켈레톤 카드 그리드 */
export function SkeletonGrid({ count, className = "stat-grid stat-grid--wide", cardStyle }: {
  count: number;
  className?: string;
  cardStyle?: CSSProperties;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" style={cardStyle} />
      ))}
    </div>
  );
}
