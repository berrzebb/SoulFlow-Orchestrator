import type { ReactNode } from "react";
import { useT } from "../i18n";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}

export function DataTable<T>({ columns, rows, rowKey, empty }: Props<T>) {
  const t = useT();
  if (!rows.length) return <div className="empty-state"><div className="empty-state__icon">📋</div><div className="empty-state__text">{empty || t("common.no_data")}</div></div>;
  return (
    <div className="table-scroll">
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) => (
              <td key={c.key}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
