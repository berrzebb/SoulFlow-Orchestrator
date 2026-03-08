import { useState, useRef, useEffect, useMemo } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  detail?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  loadingText?: string;
  className?: string;
}

export function Combobox({ options, value, onChange, placeholder, loading, loadingText, className }: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);


  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (focusIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIdx]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && focusIdx >= 0) {
      e.preventDefault();
      pick(filtered[focusIdx]!.value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const pick = (v: string) => {
    onChange(v);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} className={`combobox ${className ?? ""}`}>
      <input
        className="form-input combobox__input"
        value={open ? query : (selected?.label || value)}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setFocusIdx(-1); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); setFocusIdx(-1); }}
        onKeyDown={handleKey}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {value && !open && (
        <button
          type="button"
          className="combobox__clear"
          onClick={() => { onChange(""); setQuery(""); }}
          aria-label="Clear"
          tabIndex={-1}
        >&times;</button>
      )}
      {open && (
        <ul ref={listRef} className="combobox__list" role="listbox" aria-live="polite" aria-label={`검색 결과 ${filtered.length}개`}>
          {loading && <li className="combobox__item combobox__item--hint">{loadingText || "Loading..."}</li>}
          {!loading && filtered.length === 0 && (
            <li className="combobox__item combobox__item--hint" role="status">
              {query ? "No matches" : "No options"}
            </li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`combobox__item${o.value === value ? " combobox__item--selected" : ""}${i === focusIdx ? " combobox__item--focus" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
              onMouseEnter={() => setFocusIdx(i)}
            >
              <span className="combobox__item-label">{o.label}</span>
              {o.detail && <span className="combobox__item-detail">{o.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
