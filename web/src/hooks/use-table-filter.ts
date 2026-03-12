import { useState, useMemo } from "react";

/**
 * 검색어 + 상태 필터 상태 및 필터링 로직 통합 훅.
 * searchFields 중 하나라도 검색어가 포함되면 포함.
 * statusField 기준 칩 필터 옵션을 자동 생성.
 */
export function useTableFilter<T>(
  items: T[],
  {
    searchFields,
    statusField,
    allValue = "all",
  }: {
    searchFields: (keyof T)[];
    statusField?: keyof T;
    allValue?: string;
  },
) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(allValue);

  const get = (item: T, key: keyof T) => String((item as Record<string, unknown>)[key as string] ?? "");

  const statusOptions = useMemo(
    () => statusField ? [...new Set(items.map((item) => get(item, statusField)))] : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, statusField],
  );

  const filtered = useMemo(() => items.filter((item) => {
    if (statusField && statusFilter !== allValue && get(item, statusField) !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return searchFields.some((f) => get(item, f).toLowerCase().includes(q));
    }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, search, statusFilter, statusField, allValue, searchFields]);

  const isFiltered = !!search || statusFilter !== allValue;

  return { filtered, search, setSearch, statusFilter, setStatusFilter, statusOptions, isFiltered, allValue };
}
