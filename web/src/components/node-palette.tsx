/** 도구/스킬 검색 가능한 Command Palette 팝오버. */

import { useState, useEffect, useRef } from "react";
import { useT } from "../i18n";

interface McpServer {
  name: string;
  connected: boolean;
  tools: string[];
  error?: string;
}

export interface ToolsData {
  names: string[];
  definitions: Array<Record<string, unknown>>;
  mcp_servers: McpServer[];
  native_tools?: string[];
}

export interface SkillItem {
  name: string;
  summary?: string;
  source?: string;
}

interface PaletteItem {
  kind: "tool" | "skill";
  id: string;
  description: string;
  group: string;
}

interface NodePaletteProps {
  tools: ToolsData;
  skills: SkillItem[];
  onSelectTool: (tool_id: string, description: string) => void;
  onSelectSkill: (skill_name: string, description: string) => void;
  onClose: () => void;
}

function build_items(tools: ToolsData, skills: SkillItem[]): { items: PaletteItem[]; groups: string[] } {
  const desc_map = new Map<string, string>();
  for (const d of tools.definitions) {
    const fn = (d as { function?: { name?: string; description?: string } }).function;
    if (fn?.name) desc_map.set(fn.name, fn.description || "");
  }

  const mcp_tool_set = new Set<string>();
  for (const srv of tools.mcp_servers) {
    for (const t of srv.tools) mcp_tool_set.add(t);
  }

  const native_set = new Set(tools.native_tools || []);
  const groups: string[] = [];
  const items: PaletteItem[] = [];

  // 1. Built-in 그룹
  const builtins = tools.names.filter((n) => !mcp_tool_set.has(n) && native_set.has(n));
  if (builtins.length) {
    const g = "Built-in";
    groups.push(g);
    for (const name of builtins) {
      items.push({ kind: "tool", id: name, description: desc_map.get(name) || "", group: g });
    }
  }

  // 2. 등록된 도구 (native도 MCP도 아닌)
  const registered = tools.names.filter((n) => !mcp_tool_set.has(n) && !native_set.has(n));
  if (registered.length) {
    const g = "Registered";
    groups.push(g);
    for (const name of registered) {
      items.push({ kind: "tool", id: name, description: desc_map.get(name) || "", group: g });
    }
  }

  // 3. MCP 서버별 그룹
  for (const srv of tools.mcp_servers) {
    if (!srv.tools.length) continue;
    const g = `MCP: ${srv.name}`;
    groups.push(g);
    for (const name of srv.tools) {
      items.push({ kind: "tool", id: name, description: desc_map.get(name) || "", group: g });
    }
  }

  // 4. Skills 그룹
  if (skills.length) {
    const g = "Skills";
    groups.push(g);
    for (const s of skills) {
      items.push({ kind: "skill", id: s.name, description: s.summary || "", group: g });
    }
  }

  return { items, groups };
}

export function NodePalette({ tools, skills, onSelectTool, onSelectSkill, onClose }: NodePaletteProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { items, groups } = build_items(tools, skills);

  const filtered = (() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((it) => it.id.toLowerCase().includes(q) || it.description.toLowerCase().includes(q));
  })();

  const visible_groups = (() => {
    const set = new Set(filtered.map((it) => it.group));
    return groups.filter((g) => set.has(g));
  })();

  const flat_items = filtered.filter((it) => !collapsed.has(it.group));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setCursor(-1); }, [query]);

  const select = (item: PaletteItem) => {
    if (item.kind === "tool") onSelectTool(item.id, item.description);
    else onSelectSkill(item.id, item.description);
    onClose();
  };

  const handle_key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat_items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === "Enter" && cursor >= 0 && cursor < flat_items.length) {
      e.preventDefault();
      select(flat_items[cursor]!);
    }
  };

  // 커서 스크롤 추적
  useEffect(() => {
    if (cursor < 0) return;
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggle_group = (g: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  };

  // MCP 연결 상태 맵
  const mcp_status = (() => {
    const m = new Map<string, boolean>();
    for (const srv of tools.mcp_servers) m.set(`MCP: ${srv.name}`, srv.connected);
    return m;
  })();

  let item_idx = 0;

  return (
    <>
      <div className="node-palette__backdrop" onClick={onClose} />
      <div className="node-palette">
        <div className="node-palette__search">
          <input
            ref={inputRef}
            className="input input--sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handle_key}
            placeholder={t("palette.search_placeholder")}
          />
        </div>
        <div className="node-palette__list" ref={listRef}>
          {visible_groups.map((g) => {
            const group_items = filtered.filter((it) => it.group === g);
            const is_collapsed = collapsed.has(g);
            const connected = mcp_status.get(g);

            return (
              <div key={g} className="node-palette__group">
                <button
                  className="node-palette__group-header"
                  onClick={() => toggle_group(g)}
                >
                  <span className="node-palette__group-arrow">{is_collapsed ? "▸" : "▾"}</span>
                  <span className="node-palette__group-name">{g}</span>
                  <span className="node-palette__group-count">{group_items.length}</span>
                  {connected !== undefined && (
                    <span className={`node-palette__status ${connected ? "node-palette__status--ok" : "node-palette__status--err"}`} />
                  )}
                </button>
                {!is_collapsed && group_items.map((it) => {
                  const idx = item_idx++;
                  return (
                    <button
                      key={`${it.kind}:${it.id}`}
                      data-idx={idx}
                      className={`node-palette__item${idx === cursor ? " node-palette__item--active" : ""}`}
                      onClick={() => select(it)}
                      onMouseEnter={() => setCursor(idx)}
                    >
                      <span className="node-palette__item-icon">{it.kind === "skill" ? "⚡" : "🔧"}</span>
                      <span className="node-palette__item-name">{it.id}</span>
                      {it.description && (
                        <span className="node-palette__item-desc">{it.description}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="node-palette__empty">{t("palette.no_results")}</div>
          )}
        </div>
      </div>
    </>
  );
}
