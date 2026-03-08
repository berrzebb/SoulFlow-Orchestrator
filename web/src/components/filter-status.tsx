/**
 * 필터 결과 상태 공지 컴포넌트 — 스크린 리더 사용자를 위한 aria-live 영역.
 *
 * 사용:
 * <FilterStatus total={100} filtered={50} query="active" />
 *
 * 스크린 리더가 "50개 결과 (전체 100개 중)" 같은 메시지를 자동으로 읽음.
 */
export function FilterStatus({
  total,
  filtered,
  query,
  isEmpty,
}: {
  total: number;
  filtered: number;
  query?: string;
  isEmpty?: boolean;
}) {
  const getMessage = () => {
    if (isEmpty) {
      return query ? `"${query}"와 일치하는 항목이 없습니다.` : "데이터가 없습니다.";
    }
    if (query) {
      return `${filtered}개 결과 (전체 ${total}개 중)`;
    }
    return `${total}개 항목`;
  };

  return (
    <div className="filter-status" aria-live="polite" aria-atomic="true" role="status">
      {getMessage()}
    </div>
  );
}
