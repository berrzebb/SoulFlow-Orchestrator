import type { ReactNode } from "react";

/** table-scroll + data-table 래퍼 컴포넌트. thead/tbody를 children으로 받습니다. */
export function DataTable({ small, children, className }: {
  small?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`table-scroll${className ? ` ${className}` : ""}`}>
      <table className={`data-table${small ? " data-table--xs" : ""}`}>
        {children}
      </table>
    </div>
  );
}
