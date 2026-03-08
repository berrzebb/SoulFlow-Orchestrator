/** NodePicker — n8n-style node search & selection side panel. */

import { useState, useRef, useEffect } from "react";
import { NODE_CATEGORIES, get_nodes_by_category } from "./node-registry";
import type { FrontendNodeDescriptor } from "./node-registry";
import { get_presets_for_type } from "./node-presets";
import type { NodePreset } from "./node-presets";
import { SearchInput } from "../../components/search-input";

const SVG16_BASE = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const SVG12_BASE = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** SVG inline icons for special nodes. */
function SpecialNodeIcon({ id, color }: { id: string; color: string }) {
  const s = { ...SVG16_BASE, stroke: color };
  if (id === "__phase__") return <svg {...s}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
  if (id === "__trigger_cron__") return <svg {...s}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
  if (id === "__trigger_webhook__") return <svg {...s}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
  if (id === "__trigger_manual__") return <svg {...s} fill={color} stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
  if (id === "__trigger_channel__") return <svg {...s}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
  if (id === "__trigger_kanban__") return <svg {...s}><rect x="3" y="3" width="4" height="6" rx="1"/><rect x="9" y="3" width="4" height="8" rx="1"/><rect x="15" y="3" width="4" height="10" rx="1"/></svg>;
  if (id === "__end__") return <svg {...s}><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-5" strokeWidth={2.5} fill="none"/></svg>;
  return null;
}

/** Category header SVG icons. */
function CatIcon({ id }: { id: string }) {
  const s = SVG12_BASE;
  if (id === "core") return <svg {...s}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
  if (id === "trigger") return <svg {...s}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
  if (id === "ai") return <svg {...s}><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="5" r="4"/></svg>;
  if (id === "logic") return <svg {...s}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
  if (id === "data") return <svg {...s}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
  if (id === "integration") return <svg {...s}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
  if (id === "io") return <svg {...s}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
  if (id === "output") return <svg {...s}><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>;
  return null;
}

const SPECIAL_NODES: { id: string; label_key: string; color: string; category: string; desc_key?: string }[] = [
  { id: "__phase__", label_key: "workflows.phase_node", color: "var(--accent, #89b4fa)", category: "core", desc_key: "workflows.phase_node_desc" },
  { id: "__trigger_cron__", label_key: "workflows.cron_trigger", color: "#e67e22", category: "trigger", desc_key: "workflows.cron_trigger_desc" },
  { id: "__trigger_webhook__", label_key: "workflows.webhook_trigger", color: "#3498db", category: "trigger", desc_key: "workflows.webhook_trigger_desc" },
  { id: "__trigger_manual__", label_key: "workflows.manual_trigger", color: "#2ecc71", category: "trigger", desc_key: "workflows.manual_trigger_desc" },
  { id: "__trigger_channel__", label_key: "workflows.channel_trigger", color: "#f1c40f", category: "trigger", desc_key: "workflows.channel_trigger_desc" },
  { id: "__trigger_kanban__", label_key: "workflows.kanban_trigger", color: "#9b59b6", category: "trigger", desc_key: "workflows.kanban_trigger_desc" },
  { id: "__end__", label_key: "workflows.node_end", color: "#e74c3c", category: "core", desc_key: "workflows.node_end_desc" },
];

export interface NodePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (node_type: string, preset?: NodePreset) => void;
  t: (key: string) => string;
}

type FlatItem = { key: string; type: "special" | "node" | "preset"; node_type: string; preset?: NodePreset; label: string; desc?: FrontendNodeDescriptor; special?: typeof SPECIAL_NODES[number] };

export function NodePicker({ open, onClose, onSelect, t }: NodePickerProps) {
  const [query, setQuery] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFocusIdx(-1);
      setCollapsedCats(new Set());
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const toggleCat = (catId: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  if (!open) return null;

  const lowerQ = query.toLowerCase();
  const byCategory = get_nodes_by_category();
  const isSearching = lowerQ.length > 0;

  type FilteredCat = { id: string; label: string; nodes: { desc: FrontendNodeDescriptor; presets: NodePreset[] }[] };
  const filteredCategories: FilteredCat[] = [];

  for (const cat of NODE_CATEGORIES) {
    const descs = byCategory.get(cat.id) || [];
    const nodes: FilteredCat["nodes"] = [];

    for (const desc of descs) {
      const presets = get_presets_for_type(desc.node_type);
      if (!lowerQ) {
        nodes.push({ desc, presets });
        continue;
      }
      const nameMatch = desc.node_type.includes(lowerQ) || t(desc.toolbar_label).toLowerCase().includes(lowerQ);
      const matchedPresets = presets.filter(
        (p) => p.label.toLowerCase().includes(lowerQ) || p.description.toLowerCase().includes(lowerQ),
      );
      if (nameMatch) {
        nodes.push({ desc, presets });
      } else if (matchedPresets.length) {
        nodes.push({ desc, presets: matchedPresets });
      }
    }
    if (nodes.length) {
      filteredCategories.push({ id: cat.id, label: cat.label, nodes });
    }
  }

  const filteredSpecial = SPECIAL_NODES.filter((s) =>
    !lowerQ || t(s.label_key).toLowerCase().includes(lowerQ) || s.id.includes(lowerQ) || (s.desc_key ? t(s.desc_key) : "").toLowerCase().includes(lowerQ),
  );
  const specialCore = filteredSpecial.filter((s) => s.category === "core");
  const specialTrigger = filteredSpecial.filter((s) => s.category === "trigger");

  const hasResults = filteredCategories.length > 0 || filteredSpecial.length > 0;

  // Flat list for keyboard navigation + O(1) key→index lookup
  const flatItems: FlatItem[] = [];
  const keyToIdx = new Map<string, number>();
  for (const s of specialCore) { keyToIdx.set(s.id, flatItems.length); flatItems.push({ key: s.id, type: "special", node_type: s.id, label: t(s.label_key), special: s }); }
  for (const s of specialTrigger) { keyToIdx.set(s.id, flatItems.length); flatItems.push({ key: s.id, type: "special", node_type: s.id, label: t(s.label_key), special: s }); }
  for (const cat of filteredCategories) {
    if (!isSearching && collapsedCats.has(cat.id)) continue;
    for (const { desc, presets } of cat.nodes) {
      keyToIdx.set(desc.node_type, flatItems.length);
      flatItems.push({ key: desc.node_type, type: "node", node_type: desc.node_type, label: t(desc.toolbar_label), desc });
      for (const p of presets) {
        const k = `${desc.node_type}__${p.preset_id}`;
        keyToIdx.set(k, flatItems.length);
        flatItems.push({ key: k, type: "preset", node_type: desc.node_type, preset: p, label: p.label, desc });
      }
    }
  }

  const selectItem = (item: FlatItem) => {
    if (item.type === "preset" && item.preset) onSelect(item.node_type, item.preset);
    else onSelect(item.node_type);
  };

  const handleKeyNav = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const nextIdx = e.key === "ArrowDown"
        ? Math.min(focusIdx + 1, flatItems.length - 1)
        : Math.max(focusIdx - 1, 0);
      setFocusIdx(nextIdx);
      requestAnimationFrame(() => {
        bodyRef.current?.querySelector(`[data-picker-idx="${nextIdx}"]`)?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusIdx >= 0 && focusIdx < flatItems.length) selectItem(flatItems[focusIdx]!);
      else if (flatItems.length > 0) selectItem(flatItems[0]!);
    }
  };

  const renderSpecialItem = (s: typeof SPECIAL_NODES[number]) => {
    const idx = keyToIdx.get(s.id) ?? -1;
    const isFocused = idx === focusIdx;
    return (
      <button
        key={s.id}
        className={`node-picker__node${isFocused ? " node-picker__node--focus" : ""}`}
        data-picker-idx={idx}
        onClick={() => onSelect(s.id)}
        onMouseEnter={() => setFocusIdx(idx)}
      >
        <span className="node-picker__icon-badge" style={{ background: `color-mix(in srgb, ${s.color} 15%, transparent)` }}>
          <SpecialNodeIcon id={s.id} color={s.color} />
        </span>
        <span className="node-picker__node-info">
          <span className="node-picker__node-name">{t(s.label_key)}</span>
          {s.desc_key && <span className="node-picker__node-desc">{t(s.desc_key)}</span>}
        </span>
      </button>
    );
  };

  const renderNodeItem = (desc: FrontendNodeDescriptor, presets: NodePreset[]) => {
    const nodeIdx = keyToIdx.get(desc.node_type) ?? -1;
    const isFocused = nodeIdx === focusIdx;
    return (
      <div key={desc.node_type} className="node-picker__node-group">
        <button
          className={`node-picker__node${isFocused ? " node-picker__node--focus" : ""}`}
          data-picker-idx={nodeIdx}
          onClick={() => onSelect(desc.node_type)}
          onMouseEnter={() => setFocusIdx(nodeIdx)}
        >
          <span className="node-picker__icon-badge" style={{ background: `color-mix(in srgb, ${desc.color} 15%, transparent)` }}>
            <span style={{ color: desc.color, fontSize: 14, lineHeight: 1 }}>{desc.icon}</span>
          </span>
          <span className="node-picker__node-info">
            <span className="node-picker__node-name">{t(desc.toolbar_label)}</span>
            <span className="node-picker__node-desc">{desc.node_type}</span>
          </span>
        </button>
        {presets.length > 0 && presets.map((p) => {
          const pIdx = keyToIdx.get(`${desc.node_type}__${p.preset_id}`) ?? -1;
          return (
            <button
              key={p.preset_id}
              className={`node-picker__preset${pIdx === focusIdx ? " node-picker__preset--focus" : ""}`}
              data-picker-idx={pIdx}
              onClick={() => onSelect(desc.node_type, p)}
              onMouseEnter={() => setFocusIdx(pIdx)}
            >
              <span className="node-picker__preset-dot" style={{ background: desc.color }} />
              <span className="node-picker__preset-label">{p.label}</span>
              <span className="node-picker__preset-desc">{p.description}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="node-picker__backdrop" role="presentation" onClick={onClose} />
      <aside className="node-picker" role="dialog" aria-label={t("workflows.node_picker_title")}>
        <header className="node-picker__header">
          <span className="node-picker__header-title">{t("workflows.node_picker_title")}</span>
          <button className="node-picker__close" onClick={onClose} aria-label={t("workflows.close")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={(val) => { setQuery(val); setFocusIdx(-1); }}
          onClear={() => setQuery("")}
          placeholder={t("workflows.node_picker_search")}
          onKeyDown={handleKeyNav}
          className="node-picker__search-wrap"
          inputClassName="node-picker__search"
        />
        <div className="node-picker__body" ref={bodyRef}>
          {/* Core (Phase) */}
          {specialCore.length > 0 && (
            <section className="node-picker__section">
              <button className="node-picker__cat-toggle" onClick={() => toggleCat("core")} aria-expanded={!collapsedCats.has("core")}>
                <svg className={`node-picker__cat-chevron${collapsedCats.has("core") && !isSearching ? " node-picker__cat-chevron--closed" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <CatIcon id="core" />
                <span>{t("workflows.node_picker_cat_core")}</span>
                <span className="node-picker__cat-count">{specialCore.length}</span>
              </button>
              {(!collapsedCats.has("core") || isSearching) && specialCore.map(renderSpecialItem)}
            </section>
          )}

          {/* Trigger */}
          {specialTrigger.length > 0 && (
            <section className="node-picker__section">
              <button className="node-picker__cat-toggle" onClick={() => toggleCat("trigger")} aria-expanded={!collapsedCats.has("trigger")}>
                <svg className={`node-picker__cat-chevron${collapsedCats.has("trigger") && !isSearching ? " node-picker__cat-chevron--closed" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <CatIcon id="trigger" />
                <span>{t("workflows.node_picker_cat_trigger")}</span>
                <span className="node-picker__cat-count">{specialTrigger.length}</span>
              </button>
              {(!collapsedCats.has("trigger") || isSearching) && specialTrigger.map(renderSpecialItem)}
            </section>
          )}

          {/* Orchestration nodes by category */}
          {filteredCategories.map((cat) => (
            <section key={cat.id} className="node-picker__section">
              <button className="node-picker__cat-toggle" onClick={() => toggleCat(cat.id)} aria-expanded={!collapsedCats.has(cat.id)}>
                <svg className={`node-picker__cat-chevron${collapsedCats.has(cat.id) && !isSearching ? " node-picker__cat-chevron--closed" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                <CatIcon id={cat.id} />
                <span>{t(cat.label)}</span>
                <span className="node-picker__cat-count">{cat.nodes.length}</span>
              </button>
              {(!collapsedCats.has(cat.id) || isSearching) && cat.nodes.map(({ desc, presets }) => renderNodeItem(desc, presets))}
            </section>
          ))}

          {!hasResults && (
            <div className="node-picker__empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <p>{t("workflows.node_picker_no_results")}</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
