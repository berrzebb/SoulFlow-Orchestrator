/** NodePicker — n8n 스타일 노드 검색/선택 사이드 패널. */

import { useState, useRef, useEffect } from "react";
import { NODE_CATEGORIES, get_nodes_by_category } from "./node-registry";
import type { FrontendNodeDescriptor } from "./node-registry";
import { get_presets_for_type } from "./node-presets";
import type { NodePreset } from "./node-presets";

/** 특수 노드 타입 (Phase, Trigger). onSelect에서 `__phase__`, `__trigger_xxx__` 형태로 전달. */
const SPECIAL_NODES: { id: string; label: string; icon: string; color: string; category: string }[] = [
  { id: "__phase__", label: "Phase", icon: "⚙", color: "var(--accent, #89b4fa)", category: "core" },
  { id: "__trigger_cron__", label: "Cron Trigger", icon: "⏰", color: "#e67e22", category: "trigger" },
  { id: "__trigger_webhook__", label: "Webhook Trigger", icon: "↗", color: "#3498db", category: "trigger" },
  { id: "__trigger_manual__", label: "Manual Trigger", icon: "▶", color: "#2ecc71", category: "trigger" },
  { id: "__trigger_channel__", label: "Channel Message", icon: "💬", color: "#f1c40f", category: "trigger" },
];

export interface NodePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (node_type: string, preset?: NodePreset) => void;
  t: (key: string) => string;
}

export function NodePicker({ open, onClose, onSelect, t }: NodePickerProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const lowerQ = query.toLowerCase();
  const byCategory = get_nodes_by_category();

  type FilteredCat = { id: string; label: string; icon: string; nodes: { desc: FrontendNodeDescriptor; presets: NodePreset[] }[] };
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
      const nameMatch = desc.node_type.includes(lowerQ) || desc.toolbar_label.toLowerCase().includes(lowerQ);
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
      filteredCategories.push({ id: cat.id, label: cat.label, icon: cat.icon, nodes });
    }
  }

  // 특수 노드 (Phase + Trigger) 필터링
  const filteredSpecial = SPECIAL_NODES.filter((s) =>
    !lowerQ || s.label.toLowerCase().includes(lowerQ) || s.id.includes(lowerQ),
  );
  const specialCore = filteredSpecial.filter((s) => s.category === "core");
  const specialTrigger = filteredSpecial.filter((s) => s.category === "trigger");

  const hasResults = filteredCategories.length > 0 || filteredSpecial.length > 0;

  return (
    <>
      <div className="node-picker__backdrop" onClick={onClose} />
      <aside className="node-picker" role="dialog" aria-label={t("workflows.node_picker_title")}>
        <header className="node-picker__header">
          <span>{t("workflows.node_picker_title")}</span>
          <button className="node-picker__close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <input
          ref={searchRef}
          className="node-picker__search input input--sm"
          placeholder={t("workflows.node_picker_search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="node-picker__body">
          {/* Core (Phase) */}
          {specialCore.length > 0 && (
            <section className="node-picker__section">
              <h4 className="node-picker__cat-label">⚙ Core</h4>
              {specialCore.map((s) => (
                <button key={s.id} className="node-picker__node" onClick={() => onSelect(s.id)}>
                  <span className="node-picker__icon" style={{ color: s.color }}>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </section>
          )}

          {/* Trigger */}
          {specialTrigger.length > 0 && (
            <section className="node-picker__section">
              <h4 className="node-picker__cat-label">⚡ Trigger</h4>
              {specialTrigger.map((s) => (
                <button key={s.id} className="node-picker__node" onClick={() => onSelect(s.id)}>
                  <span className="node-picker__icon" style={{ color: s.color }}>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </section>
          )}

          {/* 오케스트레이션 노드 (카테고리별) */}
          {filteredCategories.map((cat) => (
            <section key={cat.id} className="node-picker__section">
              <h4 className="node-picker__cat-label">{cat.icon} {cat.label}</h4>
              {cat.nodes.map(({ desc, presets }) => (
                <div key={desc.node_type} className="node-picker__node-group">
                  <button
                    className="node-picker__node"
                    onClick={() => onSelect(desc.node_type)}
                  >
                    <span className="node-picker__icon" style={{ color: desc.color }}>{desc.icon}</span>
                    <span>{desc.toolbar_label.replace(/^\+\s*/, "")}</span>
                  </button>
                  {presets.length > 0 && presets.map((p) => (
                    <button
                      key={p.preset_id}
                      className="node-picker__preset"
                      onClick={() => onSelect(desc.node_type, p)}
                    >
                      <span className="node-picker__preset-label">{p.label}</span>
                      <span className="node-picker__preset-desc">{p.description}</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
          ))}

          {!hasResults && (
            <p className="node-picker__empty">{t("workflows.node_picker_no_results")}</p>
          )}
        </div>
      </aside>
    </>
  );
}
