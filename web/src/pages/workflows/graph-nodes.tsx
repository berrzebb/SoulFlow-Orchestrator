/**
 * Graph SVG node components — EdgePath, PhaseNode, AuxNode, and all sub-components.
 */

import { useState } from "react";
import { useT } from "../../i18n";
import { useConfirm } from "../../components/modal";
import { get_frontend_node } from "./node-registry";
import type { PhaseDef, NodeGroup, GraphNode } from "./workflow-types";
import type { NodePos, Edge } from "./graph-layout";
import { NODE_W, HEADER_H, FIELD_PORT_R } from "./graph-layout";

// ── Mode icons/colors ──

export const MODE_ICON: Record<string, string> = {
  parallel: "||",
  interactive: "🔄",
  sequential_loop: "🔁",
};

// ── SVG Edge Renderer ──

export function EdgePath({ from, to, from_port, to_port, positions, type, label, onDelete, onInsert, graphNodes: _gn, phases: _ph }: Edge & {
  positions: Map<string, NodePos>; onDelete?: () => void;
  onInsert?: (from_id: string, to_id: string) => void;
  graphNodes?: GraphNode[]; phases?: PhaseDef[];
}) {
  const p1 = positions.get(from);
  const p2 = positions.get(to);
  if (!p1 || !p2) return null;

  const resolvePortY = (_nodeId: string, _portName: string | undefined, _side: "out" | "in", pos: NodePos): number => {
    return pos.height / 2;
  };

  const x1 = p1.x + p1.width;
  const x2 = p2.x;
  const y1 = p1.y + resolvePortY(from, from_port, "out", p1);
  const y2 = p2.y + resolvePortY(to, to_port, "in", p2);

  if (type === "goto") {
    const belowY = Math.max(p1.y + p1.height, p2.y + p2.height) + 50;
    const d = `M ${p1.x + p1.width / 2} ${p1.y + p1.height} C ${p1.x + p1.width / 2} ${belowY}, ${p2.x + p2.width / 2} ${belowY}, ${p2.x + p2.width / 2} ${p2.y + p2.height}`;
    const labelX = (p1.x + p2.x) / 2 + NODE_W / 2;
    return (
      <g>
        <path d={d} fill="none" stroke="var(--edge-goto, var(--err, #e74c3c))" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#arrow-goto)" />
        {label && (
          <text x={labelX} y={belowY - 6} fill="var(--edge-goto, var(--err, #e74c3c))" fontSize={11} fontWeight={600} textAnchor="middle">{label}</text>
        )}
      </g>
    );
  }

  if (type === "attach") {
    const sx = p1.x + p1.width / 2;
    const sy = p1.y + p1.height;
    const ex = p2.x + p2.width / 2;
    const ey = p2.y;
    const isVertical = Math.abs(sx - ex) < p1.width;
    if (isVertical) {
      return <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--muted, #6c7086)" strokeWidth={1} strokeDasharray="3 3" />;
    }
    const midY = (sy + ey) / 2;
    const d = `M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`;
    return <path d={d} fill="none" stroke="var(--muted, #6c7086)" strokeWidth={1.2} strokeDasharray="3 3" />;
  }

  if (type === "trigger") {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return <path d={d} fill="none" stroke="var(--edge-trigger, #e67e22)" strokeWidth={1.5} strokeDasharray="8 4" markerEnd="url(#arrow-trigger)" />;
  }

  if (type === "config") {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return <path d={d} fill="none" stroke="var(--warn, #f1c40f)" strokeWidth={1.2} strokeDasharray="5 3" markerEnd="url(#arrow-config)" />;
  }

  if (type === "mapping") {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return (
      <g className={onDelete ? "graph-edge graph-edge--deletable" : "graph-edge"}>
        {onDelete && <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} onClick={onDelete} />}
        <path d={d} fill="none" stroke="var(--edge-mapping, #9b59b6)" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#arrow-mapping)" pointerEvents="none" />
        {label && (
          <text x={midX} y={Math.min(y1, y2) - 4} textAnchor="middle" fill="var(--edge-mapping, #9b59b6)" fontSize={9} fontWeight={600} pointerEvents="none">{label}</text>
        )}
      </g>
    );
  }

  // flow
  const midX = (x1 + x2) / 2;
  let detourY: number | null = null;
  if (positions.size > 2) {
    const margin = 8;
    const minX = Math.min(x1, x2) + margin;
    const maxX = Math.max(x1, x2) - margin;
    for (const [nid, np] of positions) {
      if (nid === from || nid === to) continue;
      if (np.x + np.width > minX && np.x < maxX) {
        const ny_top = np.y - margin;
        const ny_bot = np.y + np.height + margin;
        const lineMinY = Math.min(y1, y2) - margin;
        const lineMaxY = Math.max(y1, y2) + margin;
        if (ny_top < lineMaxY && ny_bot > lineMinY) {
          const distUp = Math.abs(y1 - ny_top);
          const distDown = Math.abs(ny_bot - y1);
          const bypass = distUp <= distDown ? ny_top - 20 : ny_bot + 20;
          detourY = detourY === null ? bypass : (Math.abs(bypass - y1) > Math.abs(detourY - y1) ? bypass : detourY);
        }
      }
    }
  }

  const d = detourY !== null
    ? `M ${x1} ${y1} C ${midX} ${y1}, ${x1 + (x2 - x1) * 0.3} ${detourY}, ${midX} ${detourY} S ${midX + (x2 - x1) * 0.2} ${y2}, ${x2} ${y2}`
    : `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

  const edgeMidX = midX;
  const edgeMidY = detourY !== null ? detourY : (y1 + y2) / 2;
  return (
    <g className={onDelete ? "graph-edge graph-edge--deletable" : "graph-edge"}>
      {onDelete && <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} onClick={onDelete} />}
      <path d={d} fill="none" stroke="var(--edge-flow, var(--line, #555))" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#arrow-flow)" pointerEvents="none" />
      {onInsert && (
        <g className="graph-edge-add"
          transform={`translate(${edgeMidX}, ${edgeMidY})`}
          onClick={(e) => { e.stopPropagation(); onInsert(from, to); }}
          style={{ cursor: "pointer" }}
        >
          <circle r={10} fill="var(--panel-elevated, #1e272f)" stroke="var(--accent, #89b4fa)" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={14} fill="var(--accent, #89b4fa)" pointerEvents="none">+</text>
        </g>
      )}
    </g>
  );
}

// ── Port Layout Helpers ──

const PORT_R = 6;

export function InputPort({ nodeHeight }: { nodeHeight: number }) {
  const cy = nodeHeight / 2;
  return (
    <rect x={-FIELD_PORT_R} y={cy - FIELD_PORT_R} width={FIELD_PORT_R * 2} height={FIELD_PORT_R * 2} rx={FIELD_PORT_R}
      fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5}
      className="graph-port graph-port--in"
    />
  );
}

export function OutputPort({ nodeWidth, nodeHeight, nodeId, onFieldDragStart }: {
  nodeWidth: number;
  nodeHeight: number;
  nodeId: string;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const cy = nodeHeight / 2;
  return (
    <g>
      <circle cx={nodeWidth} cy={cy} r={14} fill="transparent"
        className="graph-port graph-port--field" data-port-name="output"
        style={{ cursor: "crosshair" }}
        onMouseDown={onFieldDragStart ? (e) => { e.stopPropagation(); onFieldDragStart(nodeId, "output", e); } : undefined}
      />
      <circle cx={nodeWidth} cy={cy} r={FIELD_PORT_R} fill="var(--accent, #89b4fa)" stroke="var(--accent, #89b4fa)" strokeWidth={1} pointerEvents="none" />
    </g>
  );
}

// ── Phase Node ──

export function PhaseNode({
  phase, pos, isSelected, isRunning, onClick, onDoubleClick, onPortDragStart, onNodeDragStart, onNodeTouchStart, subSlotCount,
}: {
  phase: PhaseDef;
  pos: NodePos;
  isSelected: boolean;
  isRunning?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onPortDragStart: (nodeId: string, portName: string) => void;
  onNodeDragStart: (phase_id: string, e: React.MouseEvent) => void;
  onNodeTouchStart: (phase_id: string, touch: { clientX: number; clientY: number }) => void;
  subSlotCount?: number;
}) {
  const t = useT();
  const mode = phase.mode || "parallel";
  const borderColor = isRunning ? "var(--accent, #89b4fa)" : isSelected ? "var(--accent)" : "var(--line, #444)";
  const slots = subSlotCount || 0;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      data-node-id={phase.phase_id}
      className="graph-node"
      role="button"
      aria-label={`Phase: ${phase.title || phase.phase_id}. ${phase.agents.length} agents${phase.critic ? ", critic" : ""}. Mode: ${mode}`}
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDoubleClick(); } }}
      onMouseDown={(e) => { if (!(e.target as Element).closest(".graph-port")) onNodeDragStart(phase.phase_id, e); }}
      onTouchStart={(e) => {
        if (e.touches.length === 1 && !(e.target as Element).closest(".graph-port")) {
          onNodeTouchStart(phase.phase_id, e.touches[0]!);
        }
      }}
      style={{ cursor: "pointer" }}
    >
      {isSelected && !isRunning && (
        <rect x={-3} y={-3} width={pos.width + 6} height={pos.height + 6} rx={19}
          fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={1.5} opacity={0.5} strokeDasharray="6 3" />
      )}
      {isRunning && (
        <rect x={-4} y={-4} width={pos.width + 8} height={pos.height + 8} rx={20}
          fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={2} opacity={0.6} className="node-running-glow" />
      )}
      <rect width={pos.width} height={pos.height} rx={12} fill="var(--node-bg, #1e272f)"
        stroke={borderColor} strokeWidth={isRunning ? 2.5 : isSelected ? 2.5 : 1} filter="url(#node-shadow)" />
      <clipPath id={`clip-header-${phase.phase_id}`}>
        <rect width={pos.width} height={HEADER_H} rx={12} />
      </clipPath>
      <rect width={pos.width} height={HEADER_H} clipPath={`url(#clip-header-${phase.phase_id})`} fill="var(--accent, #89b4fa)" opacity={0.12} />
      <line x1={0} y1={HEADER_H} x2={pos.width} y2={HEADER_H} stroke="var(--accent, #89b4fa)" strokeWidth={0.5} opacity={0.2} />
      <text x={12} y={14} fontSize={13} fill="var(--accent, #89b4fa)">{MODE_ICON[mode] || "⚙"}</text>
      <text x={30} y={14} fill="var(--text, #cdd6f4)" fontSize={12} fontWeight={700}>
        {(phase.title || phase.phase_id).length > 18 ? (phase.title || phase.phase_id).slice(0, 18) + "…" : (phase.title || phase.phase_id)}
        <title>{phase.title || phase.phase_id}</title>
      </text>
      <text x={pos.width - 20} y={14} fill="var(--accent, #89b4fa)" fontSize={12}>▸</text>

      {phase.description ? (
        <foreignObject x={8} y={HEADER_H + 4} width={pos.width - 16} height={pos.height - HEADER_H - 8}>
          <div style={{
            fontSize: 10, lineHeight: "14px", color: "var(--subtext, #bac2de)",
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const,
            wordBreak: "break-word",
          }} title={phase.description}>{phase.description}</div>
        </foreignObject>
      ) : (
        <text x={12} y={HEADER_H + 14} fill="var(--muted, #a0adb8)" fontSize={10}>
          {phase.agents.length} agent{phase.agents.length !== 1 ? "s" : ""}
          {phase.critic ? " · critic" : ""}
          {mode !== "parallel" ? ` · ${MODE_ICON[mode]}` : ""}
        </text>
      )}

      {phase.depends_on?.length ? (
        <g>
          <text x={12} y={HEADER_H + 30} fill="var(--muted, #a0adb8)" fontSize={9} opacity={0.7}>{t("workflows.used_in_step")}</text>
          {phase.depends_on.slice(0, 3).map((dep, i) => (
            <g key={dep} transform={`translate(${12 + i * 68}, ${HEADER_H + 36})`}>
              <rect width={64} height={18} rx={9} fill="var(--accent, #89b4fa)" opacity={0.12} />
              <text x={6} y={12} fill="var(--accent, #89b4fa)" fontSize={9} fontWeight={500}>
                {dep.length > 8 ? dep.slice(0, 8) + "…" : dep}
              </text>
            </g>
          ))}
        </g>
      ) : null}

      <InputPort nodeHeight={pos.height} />
      <OutputPort nodeWidth={pos.width} nodeHeight={pos.height} nodeId={phase.phase_id}
        onFieldDragStart={(id, _fieldName) => onPortDragStart(id, "output")} />

      {slots > 0 && (() => {
        const slot_gap = Math.min(20, (pos.width - 24) / slots);
        const start_x = (pos.width - (slots - 1) * slot_gap) / 2;
        return Array.from({ length: slots }, (_, i) => {
          const sx = start_x + i * slot_gap;
          return (
            <polygon key={`slot-${i}`}
              points={`${sx},${pos.height - 4} ${sx + 4},${pos.height} ${sx},${pos.height + 4} ${sx - 4},${pos.height}`}
              fill="var(--muted, #6c7086)" opacity={0.5} />
          );
        });
      })()}

      {isSelected && (
        <g transform={`translate(${pos.width - 14}, ${pos.height - 14})`}
          onClick={(e) => { e.stopPropagation(); onDoubleClick(); }} className="graph-edit-btn">
          <circle r={10} fill="var(--accent, #89b4fa)" opacity={0.9} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--bg, #1e1e2e)" style={{ pointerEvents: "none" }}>✎</text>
        </g>
      )}
    </g>
  );
}

// ── Auxiliary Node Components ──

const SUB_COLORS: Record<string, string> = {
  agent: "#5dade2", critic: "#e74c3c", tool: "#95a5a6", skill: "#2ecc71",
  end_channel: "#3498db", end_media: "#e67e22", end_webhook: "#ff9800", end_http: "#1abc9c",
};
const SUB_ICONS: Record<string, string> = {
  agent: "🤖", critic: "⚖", tool: "🔧", skill: "⚡",
  end_channel: "💬", end_media: "🎬", end_webhook: "🪝", end_http: "🌐",
};

function ClusterSubNode({ node, pos, onDoubleClick }: {
  node: GraphNode; pos: NodePos;
  onDoubleClick?: () => void;
}) {
  const color = SUB_COLORS[node.sub_type || "agent"] || "#888";
  const icon = SUB_ICONS[node.sub_type || "agent"] || "?";
  const r = pos.width / 2;
  const cx = r, cy = r;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      style={{ cursor: "pointer" }}>
      <circle cx={cx} cy={cy} r={r + 4} fill="transparent" />
      <circle cx={cx} cy={cy} r={r - 1} fill="var(--panel-elevated, #1e272f)" stroke={color} strokeWidth={2} filter="url(#node-shadow)" />
      <circle cx={cx} cy={cy} r={r - 1} fill={color} opacity={0.08} />
      <text x={cx} y={cy - 1} textAnchor="middle" dominantBaseline="central" fontSize={15}>{icon}</text>
      <text x={cx} y={cy + r + 14} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10} fontWeight={500}>
        {node.label.length > 12 ? node.label.slice(0, 12) + "…" : node.label}
        <title>{node.label}</title>
      </text>
      <polygon points={`${cx},-4 ${cx + 4},0 ${cx},4 ${cx - 4},0`} fill={color} />
    </g>
  );
}

const TRIGGER_COLORS: Record<string, string> = {
  cron: "#e67e22", webhook: "#3498db", manual: "#2ecc71", channel_message: "#f1c40f", kanban_event: "#9b59b6",
};
const TRIGGER_ICONS: Record<string, string> = {
  cron: "⏰", webhook: "↗", manual: "▶", channel_message: "💬", kanban_event: "📋",
};

function TriggerNode({ node, pos, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const triggerType = node.sub_label || "manual";
  const color = TRIGGER_COLORS[triggerType] || "#e67e22";
  const icon = TRIGGER_ICONS[triggerType] || "▶";
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <rect width={pos.width} height={pos.height} rx={pos.height / 2} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1} />
      <circle cx={22} cy={18} r={14} fill={color} opacity={0.15} />
      <circle cx={22} cy={18} r={14} fill="none" stroke={color} strokeWidth={1.2} opacity={0.4} />
      <text x={22} y={22} textAnchor="middle" fontSize={12}>{icon}</text>
      <text x={42} y={16} fill="var(--text, #cdd6f4)" fontSize={12} fontWeight={700}>
        {node.label.length > 12 ? node.label.slice(0, 12) + "…" : node.label}
      </text>
      {node.trigger_detail && (
        <text x={42} y={28} fill="var(--muted, #a0adb8)" fontSize={9} fontFamily="monospace">
          {node.trigger_detail.length > 18 ? node.trigger_detail.slice(0, 18) + "…" : node.trigger_detail}
        </text>
      )}
      <OutputPort nodeWidth={pos.width} nodeHeight={pos.height} nodeId={node.id} onFieldDragStart={onFieldDragStart} />
    </g>
  );
}

function ChannelNode({ node, pos, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const w = pos.width, h = pos.height;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <rect width={w} height={h} rx={h / 2} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1} />
      <circle cx={22} cy={18} r={14} fill="var(--yellow, #f1c40f)" opacity={0.15} />
      <circle cx={22} cy={18} r={14} fill="none" stroke="var(--yellow, #f1c40f)" strokeWidth={1.2} opacity={0.4} />
      <text x={22} y={22} textAnchor="middle" fontSize={12}>💬</text>
      <text x={42} y={16} fill="var(--text, #cdd6f4)" fontSize={12} fontWeight={700}>
        {node.label.length > 12 ? node.label.slice(0, 12) + "…" : node.label}
      </text>
      {node.sub_label && (
        <text x={42} y={28} fill="var(--muted, #a0adb8)" fontSize={10}>{node.sub_label}</text>
      )}
      <InputPort nodeHeight={h} />
      <OutputPort nodeWidth={w} nodeHeight={h} nodeId={node.id} onFieldDragStart={onFieldDragStart} />
    </g>
  );
}

// ── Orchestration Node Components ──

export function orche_color(node_type: string): string {
  return get_frontend_node(node_type)?.color || "#888";
}

export function orche_icon(node_type: string): string {
  return get_frontend_node(node_type)?.icon || "";
}

function get_node_subtitle(node: GraphNode): string {
  const d = node.orche_data || {};
  switch (node.type) {
    case "http": return `${d.method || "GET"} ${truncate_str(String(d.url || ""), 24)}`;
    case "code": return String(d.language || "javascript");
    case "llm": return String(d.model || "default model");
    case "ai_agent": return String(d.model || "agent");
    case "if": return truncate_str(String(d.condition || ""), 24);
    case "set": return Object.keys((d.assignments as Record<string, unknown>) || {}).slice(0, 3).join(", ") || "variables";
    case "db": return String(d.datasource || "query");
    case "template": return "Mustache template";
    case "loop": return `items: ${truncate_str(String(d.items_expression || "…"), 20)}`;
    case "filter": return truncate_str(String(d.condition || "filter"), 24);
    case "transform": return truncate_str(String(d.expression || "map"), 24);
    case "switch": return `${((d.cases as unknown[]) || []).length || 0} cases`;
    case "wait": return String(d.wait_type || d.delay_ms ? `${d.delay_ms}ms` : "await");
    case "file": return String(d.operation || "read");
    case "analyzer": return String(d.model || "structured output");
    case "retriever": return String(d.source_type || "search");
    case "embedding": return String(d.model || "embed");
    case "vector_store": return String(d.operation || "query");
    case "sub_workflow": return truncate_str(String(d.workflow_name || ""), 24);
    case "oauth": return String(d.provider_name || "OAuth");
    default: return node.sub_label || "";
  }
}

function truncate_str(s: string, max: number): string { return s.length > max ? s.slice(0, max) + "…" : s; }

const STATUS_BADGE: Record<string, { icon: string; color: string }> = {
  running: { icon: "⟳", color: "#3498db" },
  completed: { icon: "✓", color: "#2ecc71" },
  failed: { icon: "✗", color: "#e74c3c" },
  skipped: { icon: "⊘", color: "#6c7086" },
};

function OrcheRectNode({ node, pos, nodeStatus, onFieldDragStart }: {
  node: GraphNode; pos: NodePos; nodeStatus?: string;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const color = orche_color(node.type) || "#888";
  const icon = orche_icon(node.type);
  const subtitle = get_node_subtitle(node);
  const badge = nodeStatus ? STATUS_BADGE[nodeStatus] : undefined;

  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}
      role="button" aria-label={`${node.type}: ${node.label}${subtitle ? `. ${subtitle}` : ""}`}>
      <rect width={pos.width} height={pos.height} rx={12} fill="var(--node-bg, #1e272f)" stroke="var(--line, #2b3742)" strokeWidth={1} filter="url(#node-shadow)" />
      <clipPath id={`clip-orche-${node.id}`}>
        <rect width={pos.width} height={HEADER_H} rx={12} />
      </clipPath>
      <rect width={pos.width} height={HEADER_H} clipPath={`url(#clip-orche-${node.id})`} fill={color} opacity={0.12} />
      <line x1={0} y1={HEADER_H} x2={pos.width} y2={HEADER_H} stroke={color} strokeWidth={0.5} opacity={0.2} />
      <text x={12} y={14} fontSize={13}>{icon}</text>
      <text x={30} y={14} fill="var(--text, #cdd6f4)" fontSize={12} fontWeight={700}>
        {node.label.length > 14 ? node.label.slice(0, 14) + "…" : node.label}
      </text>
      <text x={pos.width - 20} y={14} fill={color} fontSize={12}>▸</text>
      {badge && (
        <g transform={`translate(${pos.width - 36}, 8)`}>
          <circle r={8} fill={badge.color} opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={10} fill={badge.color} style={{ pointerEvents: "none" }}>{badge.icon}</text>
        </g>
      )}
      {subtitle && (
        <text x={12} y={HEADER_H + 14} fill="var(--muted, #a0adb8)" fontSize={10}>
          {subtitle.length > 24 ? subtitle.slice(0, 24) + "…" : subtitle}
        </text>
      )}
      <rect x={-5} y={pos.height / 2 - 5} width={10} height={10} rx={5} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5} className="graph-port graph-port--in" />
      <OutputPort nodeWidth={pos.width} nodeHeight={pos.height} nodeId={node.id} onFieldDragStart={onFieldDragStart} />
    </g>
  );
}

// ── Diamond Nodes ──

function SplitDiamondNode({ node, pos, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const w = pos.width, h = pos.height;
  const color = orche_color("split");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel-elevated, #1e272f)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 - 6} textAnchor="middle" fill={color} fontSize={16} fontWeight={700}>↕</text>
      <text x={w / 2} y={h / 2 + 12} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5} className="graph-port graph-port--in" />
      <g>
        <circle cx={w} cy={h / 2} r={14} fill="transparent" className="graph-port graph-port--field" data-port-name="output" style={{ cursor: "crosshair" }}
          onMouseDown={(e) => { e.stopPropagation(); onFieldDragStart?.(node.id, "output", e); }} />
        <circle cx={w} cy={h / 2} r={FIELD_PORT_R} fill={color} stroke={color} strokeWidth={1} pointerEvents="none" />
      </g>
    </g>
  );
}

function SwitchDiamondNode({ node, pos, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const w = pos.width, h = pos.height;
  const color = orche_color("switch");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel-elevated, #1e272f)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 - 6} textAnchor="middle" fill={color} fontSize={14} fontWeight={700}>⑆</text>
      <text x={w / 2} y={h / 2 + 12} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={2}
        fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5} className="graph-port graph-port--in" />
      <g>
        <circle cx={w} cy={h / 2} r={14} fill="transparent" className="graph-port graph-port--field" data-port-name="output" style={{ cursor: "crosshair" }}
          onMouseDown={(e) => { e.stopPropagation(); onFieldDragStart?.(node.id, "output", e); }} />
        <circle cx={w} cy={h / 2} r={FIELD_PORT_R} fill={color} stroke={color} strokeWidth={1} pointerEvents="none" />
      </g>
    </g>
  );
}

function IfDiamondNode({ node, pos }: { node: GraphNode; pos: NodePos }) {
  const t = useT();
  const w = pos.width, h = pos.height;
  const color = orche_color("if");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel-elevated, #1e272f)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 - 6} textAnchor="middle" fill={color} fontSize={16} fontWeight={700}>?</text>
      <text x={w / 2} y={h / 2 + 12} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      <circle cx={w} cy={h * 0.35} r={PORT_R} fill="#2ecc71" stroke="#2ecc71" strokeWidth={1.5} className="graph-port graph-port--field" />
      <text x={w + 12} y={h * 0.35 + 3} fill="#2ecc71" fontSize={8} fontWeight={600}>{t("workflows.true_label")}</text>
      <circle cx={w} cy={h * 0.65} r={PORT_R} fill="var(--err, #e74c3c)" stroke="var(--err, #e74c3c)" strokeWidth={1.5} className="graph-port graph-port--field" />
      <text x={w + 12} y={h * 0.65 + 3} fill="var(--err, #e74c3c)" fontSize={8} fontWeight={600}>{t("workflows.false_label")}</text>
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5} className="graph-port graph-port--in" />
    </g>
  );
}

function MergeDiamondNode({ node: _node, pos }: { node: GraphNode; pos: NodePos }) {
  const w = pos.width, h = pos.height;
  const color = orche_color("merge");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel-elevated, #1e272f)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fill={color} fontSize={16} fontWeight={700}>⊕</text>
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5} className="graph-port graph-port--in" />
      <circle cx={w} cy={h / 2} r={PORT_R} fill={color} stroke={color} strokeWidth={1.5} className="graph-port graph-port--out" />
    </g>
  );
}

function EndNode({ node: _node, pos }: { node: GraphNode; pos: NodePos }) {
  const t = useT();
  const w = pos.width, h = pos.height;
  const color = "#e74c3c";
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <rect width={w} height={h} rx={12} fill="var(--node-bg, #1e272f)" stroke={color} strokeWidth={2} filter="url(#node-shadow)" />
      <rect x={3} y={3} width={w - 6} height={h - 6} rx={10} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4} />
      <text x={24} y={22} textAnchor="middle" fontSize={16}>⏹</text>
      <text x={44} y={17} fill="var(--text, #cdd6f4)" fontSize={12} fontWeight={700}>{t("workflows.end_label")}</text>
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel-elevated, #1e272f)" stroke="var(--muted, #6c7086)" strokeWidth={1.5} className="graph-port graph-port--in" />
      <line x1={w * 0.3} y1={h} x2={w * 0.7} y2={h} stroke={color} strokeWidth={1} opacity={0.3} />
    </g>
  );
}

// ── Add Handle ──

export function AddHandle({ pos, onClick, onDragStart }: {
  pos: NodePos;
  onClick: () => void;
  onDragStart?: (origin: { x: number; y: number }, e: React.MouseEvent | React.TouchEvent) => void;
}) {
  const cx = pos.x + pos.width + 16;
  const cy = pos.y + pos.height / 2;
  return (
    <g className="graph-add-handle"
      transform={`translate(${cx}, ${cy})`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        onDragStart?.({ x: cx, y: cy }, e);
      }}
      onTouchStart={(e) => {
        if (e.touches.length !== 1) return;
        e.stopPropagation();
        onDragStart?.({ x: cx, y: cy }, e);
      }}
      style={{ cursor: "grab" }}
    >
      <circle r={12} fill="var(--panel-elevated, #1e272f)" stroke="var(--accent, #89b4fa)" strokeWidth={1.5} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={16} fill="var(--accent, #89b4fa)" pointerEvents="none">+</text>
    </g>
  );
}

// ── Group Frame ──

export function GroupFrame({ group, positions, onUpdate, onDelete, onToggleCollapse }: {
  group: NodeGroup;
  positions: Map<string, NodePos>;
  onUpdate: (patch: Partial<NodeGroup>) => void;
  onDelete: () => void;
  onToggleCollapse: () => void;
}) {
  const t = useT();
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirm();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.label);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of group.node_ids) {
    const p = positions.get(id);
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  if (minX === Infinity) return null;
  const pad = 20;
  const headerH = 28;

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== group.label) onUpdate({ label: trimmed });
    setRenaming(false);
  };

  return (
    <g className="graph-group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <rect x={minX - pad} y={minY - pad - headerH} width={maxX - minX + pad * 2} height={maxY - minY + pad * 2 + headerH}
        rx={12} fill={group.color} fillOpacity={0.08} stroke={group.color} strokeOpacity={0.3} strokeWidth={1.5} />
      {renaming ? (
        <foreignObject x={minX - pad + 8} y={minY - pad - headerH + 2} width={160} height={24}>
          <input className="graph-group__rename-input" autoFocus value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }} />
        </foreignObject>
      ) : (
        <text x={minX - pad + 12} y={minY - pad - 8} fill={group.color} fontSize={13} fontWeight={600}>{group.label}</text>
      )}
      {hovered && !renaming && (
        <foreignObject x={maxX - 80} y={minY - pad - headerH + 2} width={100} height={24}>
          <div className="graph-group__toolbar" style={{ display: "flex", gap: 2 }}>
            <button onClick={onToggleCollapse} title={group.collapsed ? t("workflows.group_expand") : t("workflows.group_collapse")}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                {group.collapsed ? <polygon points="2,0 10,5 2,10" /> : <polygon points="0,2 10,2 5,10" />}
              </svg>
            </button>
            <button onClick={() => { setRenameValue(group.label); setRenaming(true); }} title={t("workflows.group_rename_prompt")}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button onClick={() => confirmAction(t("workflows.remove_confirm"), onDelete)} className="graph-ctx__item--danger" aria-label={t("workflows.delete")}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
            </button>
          </div>
        </foreignObject>
      )}
      {confirmDialog}
    </g>
  );
}

// ── Aux Node Dispatcher ──

export function is_orche_type(t: string): boolean {
  return !!get_frontend_node(t);
}

export function AuxNode({ node, pos, isRunning, isSelected, nodeStatus, onDragStart, onTouchStart, onDoubleClick, onFieldDragStart, onClick, onSubNodeClick }: {
  node: GraphNode;
  pos: NodePos;
  isRunning?: boolean;
  isSelected?: boolean;
  nodeStatus?: string;
  onDragStart?: (id: string, e: React.MouseEvent) => void;
  onTouchStart?: (id: string, touch: { clientX: number; clientY: number }) => void;
  onDoubleClick?: (id: string) => void;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
  onClick?: (id: string) => void;
  onSubNodeClick?: (id: string) => void;
}) {
  const is_orche = is_orche_type(node.type);

  const inner = (() => {
    switch (node.type) {
      case "sub_node": return <ClusterSubNode node={node} pos={pos} onDoubleClick={() => onDoubleClick?.(node.id)} />;
      case "trigger": return <TriggerNode node={node} pos={pos} onFieldDragStart={onFieldDragStart} />;
      case "channel": return <ChannelNode node={node} pos={pos} onFieldDragStart={onFieldDragStart} />;
      case "end": return <EndNode node={node} pos={pos} />;
    }
    const desc = get_frontend_node(node.type);
    if (!desc) return null;
    if (desc.shape === "rect") {
      return <OrcheRectNode node={node} pos={pos} nodeStatus={nodeStatus || (isRunning ? "running" : undefined)} onFieldDragStart={onFieldDragStart} />;
    }
    switch (node.type) {
      case "if": return <IfDiamondNode node={node} pos={pos} />;
      case "merge": return <MergeDiamondNode node={node} pos={pos} />;
      case "split": return <SplitDiamondNode node={node} pos={pos} onFieldDragStart={onFieldDragStart} />;
      case "switch": return <SwitchDiamondNode node={node} pos={pos} onFieldDragStart={onFieldDragStart} />;
      default: return null;
    }
  })();

  return (
    <g
      data-node-id={node.id}
      className="graph-node"
      role="button"
      aria-label={`${node.type}: ${node.label}`}
      tabIndex={0}
      style={{ cursor: "grab" }}
      onClick={() => { onClick?.(node.id); if (node.type === "sub_node" && onSubNodeClick) onSubNodeClick(node.id); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDoubleClick?.(node.id); } }}
      onMouseDown={(e) => { if (!(e.target as Element).closest(".graph-port, .graph-play-btn")) onDragStart?.(node.id, e); }}
      onTouchStart={(e) => { if (e.touches.length === 1 && !(e.target as Element).closest(".graph-port, .graph-play-btn")) onTouchStart?.(node.id, e.touches[0]!); }}
      onDoubleClick={() => onDoubleClick?.(node.id)}
    >
      {isSelected && (
        <rect x={pos.x - 3} y={pos.y - 3} width={pos.width + 6} height={pos.height + 6} rx={12}
          fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.5} />
      )}
      {isRunning && is_orche && (
        <rect x={pos.x - 4} y={pos.y - 4} width={pos.width + 8} height={pos.height + 8} rx={14}
          fill="none" stroke={orche_color(node.type) || "var(--accent, #89b4fa)"} strokeWidth={2} opacity={0.6} className="node-running-glow" />
      )}
      {inner}
    </g>
  );
}
