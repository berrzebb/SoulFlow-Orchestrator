/** 단일 선택 필터 칩 바. ws-chip-bar 내에 filter-chip 버튼들을 렌더링합니다. */
export function ChipBar({ options, value, onChange, className }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`ws-chip-bar${className ? ` ${className}` : ""}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`filter-chip${value === opt.value ? " filter-chip--active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
