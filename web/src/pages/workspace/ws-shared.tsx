import type { ReactNode, KeyboardEvent } from "react";
import { useT } from "../../i18n";

/** 클릭/키보드 활성화 가능한 워크스페이스 목록 아이템 */
export function WsListItem({ id, active, onClick, className, children }: {
  id: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const handle_key = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
  };
  return (
    <div
      key={id}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handle_key}
      className={`ws-item${active ? " ws-item--active" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

/** 워크스페이스 스켈레톤 로딩 — 세로 나열된 스켈레톤 줄들 */
export function WsSkeletonCol({ rows }: { rows: Array<"text" | "text-sm" | "card" | "row"> }) {
  return (
    <div className="ws-skeleton-col">
      {rows.map((r, i) => <div key={i} className={`skeleton skeleton--${r}`} />)}
    </div>
  );
}

/** 워크스페이스 상세 패널 헤더 — 뒤로 버튼 + 우측 컨텐츠 */
export function WsDetailHeader({ onBack, children }: {
  onBack?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="ws-detail-header">
      {onBack && (
        <button className="ws-back-btn" onClick={onBack}>{t("common.back")}</button>
      )}
      {children}
    </div>
  );
}
