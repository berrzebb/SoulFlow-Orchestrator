/**
 * Graph Editor — SVG 기반 노드-엣지 워크플로우 편집기.
 * 메인 뷰: 노드(Phase) 배치 + 엣지(depends_on, goto) 연결.
 * 노드 클릭 → 인라인 프로퍼티 패널, 드래그로 위치 조정.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useT } from "../../i18n";

// ── Types (builder.tsx와 동일) ──

export interface AgentDef {
  agent_id: string;
  role: string;
  label: string;
  backend: string;
  model?: string;
  system_prompt: string;
  tools?: string[];
  max_turns?: number;
}

export interface CriticDef {
  backend: string;
  model?: string;
  system_prompt: string;
  gate: boolean;
  on_rejection?: string;
  goto_phase?: string;
  max_retries?: number;
}

export interface PhaseDef {
  phase_id: string;
  title: string;
  agents: AgentDef[];
  critic?: CriticDef;
  context_template?: string;
  failure_policy?: string;
  mode?: "parallel" | "interactive" | "sequential_loop";
  max_loop_iterations?: number;
  loop_until?: string;
  depends_on?: string[];
}

export interface WorkflowDef {
  title: string;
  objective: string;
  variables?: Record<string, string>;
  phases: PhaseDef[];
}

// ── Layout ──

type NodePos = { x: number; y: number; width: number; height: number };

const NODE_W = 200;
const NODE_H = 72;
const GAP_X = 60;
const GAP_Y = 100;
const PADDING = 40;

/** Topological layer 할당: depends_on 기반으로 레이어 계산. */
function compute_layers(phases: PhaseDef[]): Map<string, number> {
  const layers = new Map<string, number>();
  const id_set = new Set(phases.map((p) => p.phase_id));

  function get_layer(id: string, visited: Set<string>): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0; // circular guard
    visited.add(id);
    const phase = phases.find((p) => p.phase_id === id);
    if (!phase?.depends_on?.length) { layers.set(id, 0); return 0; }
    const max_dep = Math.max(...phase.depends_on.filter((d) => id_set.has(d)).map((d) => get_layer(d, visited)));
    const layer = max_dep + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const p of phases) get_layer(p.phase_id, new Set());

  // depends_on이 없는 Phase는 순서대로 배치
  let seq = 0;
  for (const p of phases) {
    if (!layers.has(p.phase_id)) {
      layers.set(p.phase_id, seq);
    }
    seq = Math.max(seq, layers.get(p.phase_id)! + 1);
  }

  return layers;
}

/** 노드 위치 계산. */
function compute_positions(phases: PhaseDef[]): Map<string, NodePos> {
  const layers = compute_layers(phases);
  const positions = new Map<string, NodePos>();

  // 레이어별 그룹
  const layer_groups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    if (!layer_groups.has(layer)) layer_groups.set(layer, []);
    layer_groups.get(layer)!.push(id);
  }

  const max_layer = Math.max(0, ...layer_groups.keys());
  for (let layer = 0; layer <= max_layer; layer++) {
    const ids = layer_groups.get(layer) || [];
    const total_w = ids.length * NODE_W + (ids.length - 1) * GAP_X;
    const start_x = PADDING + (ids.length > 1 ? 0 : (NODE_W + GAP_X) * 0.5);
    const center_offset = ids.length > 1 ? -total_w / 2 + NODE_W / 2 : 0;

    ids.forEach((id, i) => {
      positions.set(id, {
        x: PADDING + i * (NODE_W + GAP_X) + (ids.length > 1 ? (max_layer > 0 ? ((NODE_W + GAP_X) * (Math.max(...[...layer_groups.values()].map((g) => g.length)) - ids.length)) / 2 : 0) : 0),
        y: PADDING + layer * (NODE_H + GAP_Y),
        width: NODE_W,
        height: NODE_H,
      });
    });
  }

  return positions;
}

// ── Edge types ──

type Edge = {
  from: string;
  to: string;
  type: "flow" | "goto";
  label?: string;
};

function compute_edges(phases: PhaseDef[]): Edge[] {
  const edges: Edge[] = [];
  const id_set = new Set(phases.map((p) => p.phase_id));

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;

    // depends_on 엣지
    if (phase.depends_on?.length) {
      for (const dep of phase.depends_on) {
        if (id_set.has(dep)) edges.push({ from: dep, to: phase.phase_id, type: "flow" });
      }
    } else if (i > 0) {
      // 명시적 depends_on이 없으면 순차 연결
      edges.push({ from: phases[i - 1]!.phase_id, to: phase.phase_id, type: "flow" });
    }

    // goto 엣지 (critic)
    if (phase.critic?.on_rejection === "goto" && phase.critic.goto_phase && id_set.has(phase.critic.goto_phase)) {
      edges.push({
        from: phase.phase_id,
        to: phase.critic.goto_phase,
        type: "goto",
        label: "FAIL",
      });
    }
  }

  return edges;
}

// ── Mode icons/colors ──

const MODE_ICON: Record<string, string> = {
  parallel: "||",
  interactive: "🔄",
  sequential_loop: "🔁",
};

const MODE_COLOR: Record<string, string> = {
  parallel: "var(--accent)",
  interactive: "#e67e22",
  sequential_loop: "#9b59b6",
};

// ── SVG Edge Renderer ──

function EdgePath({ from, to, positions, type, label }: Edge & { positions: Map<string, NodePos> }) {
  const p1 = positions.get(from);
  const p2 = positions.get(to);
  if (!p1 || !p2) return null;

  const x1 = p1.x + p1.width / 2;
  const y1 = p1.y + p1.height;
  const x2 = p2.x + p2.width / 2;
  const y2 = p2.y;

  const isGoto = type === "goto";

  // goto: 오른쪽으로 우회하는 커브
  if (isGoto) {
    const offset = 40;
    const rightX = Math.max(x1, x2) + offset + 30;
    const d = `M ${x1 + p1.width / 2 - 10} ${p1.y + p1.height / 2} C ${rightX} ${p1.y + p1.height / 2}, ${rightX} ${p2.y + p2.height / 2}, ${x2 + p2.width / 2 - 10} ${p2.y + p2.height / 2}`;
    return (
      <g>
        <path
          d={d}
          fill="none"
          stroke="var(--err, #e74c3c)"
          strokeWidth={2}
          strokeDasharray="6 4"
          markerEnd="url(#arrow-goto)"
        />
        {label && (
          <text
            x={rightX - 10}
            y={(p1.y + p2.y) / 2 + NODE_H / 2}
            fill="var(--err, #e74c3c)"
            fontSize={11}
            fontWeight={600}
            textAnchor="middle"
          >
            {label}
          </text>
        )}
      </g>
    );
  }

  // flow: 직선 또는 부드러운 커브
  const midY = (y1 + y2) / 2;
  const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--line, #555)"
      strokeWidth={1.5}
      markerEnd="url(#arrow-flow)"
    />
  );
}

// ── Phase Node ──

const PORT_R = 6;

function PhaseNode({
  phase, pos, isSelected, onClick, onDoubleClick, onPortDragStart, onNodeDragStart,
}: {
  phase: PhaseDef;
  pos: NodePos;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onPortDragStart: (phase_id: string, port: "out" | "goto") => void;
  onNodeDragStart: (phase_id: string, e: React.MouseEvent) => void;
}) {
  const mode = phase.mode || "parallel";
  const borderColor = isSelected ? "var(--accent)" : "var(--line, #444)";

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={(e) => { if (!(e.target as Element).closest(".graph-port")) onNodeDragStart(phase.phase_id, e); }}
      style={{ cursor: "pointer" }}
    >
      <rect
        width={pos.width}
        height={pos.height}
        rx={8}
        fill="var(--panel, #1e1e2e)"
        stroke={borderColor}
        strokeWidth={isSelected ? 2.5 : 1.5}
      />
      {/* Mode 뱃지 */}
      <rect
        x={pos.width - 32}
        y={6}
        width={26}
        height={18}
        rx={4}
        fill={MODE_COLOR[mode] || "var(--accent)"}
        opacity={0.2}
      />
      <text
        x={pos.width - 19}
        y={18}
        textAnchor="middle"
        fontSize={10}
        fill={MODE_COLOR[mode] || "var(--accent)"}
      >
        {MODE_ICON[mode]}
      </text>

      {/* Phase 제목 */}
      <text
        x={12}
        y={24}
        fill="var(--text, #cdd6f4)"
        fontSize={13}
        fontWeight={600}
      >
        {phase.title || phase.phase_id}
      </text>

      {/* Agent 수 + Critic 표시 */}
      <text
        x={12}
        y={44}
        fill="var(--muted, #6c7086)"
        fontSize={11}
      >
        {phase.agents.length} agent{phase.agents.length !== 1 ? "s" : ""}
        {phase.critic ? " + critic" : ""}
      </text>

      {/* depends_on 표시 */}
      {phase.depends_on?.length ? (
        <text
          x={12}
          y={60}
          fill="var(--muted, #6c7086)"
          fontSize={9}
        >
          deps: {phase.depends_on.join(", ")}
        </text>
      ) : null}

      {/* 입력 포트 (상단 중앙) */}
      <circle
        cx={pos.width / 2}
        cy={0}
        r={PORT_R}
        fill="var(--panel, #1e1e2e)"
        stroke="var(--line, #555)"
        strokeWidth={1.5}
        className="graph-port graph-port--in"
        data-phase-id={phase.phase_id}
        data-port="in"
      />

      {/* 출력 포트 (하단 중앙) — flow 연결용 */}
      <circle
        cx={pos.width / 2}
        cy={pos.height}
        r={PORT_R}
        fill="var(--accent, #89b4fa)"
        stroke="var(--accent, #89b4fa)"
        strokeWidth={1.5}
        className="graph-port graph-port--out"
        onMouseDown={(e) => { e.stopPropagation(); onPortDragStart(phase.phase_id, "out"); }}
      />

      {/* goto 포트 (우측 중앙) — critic goto 연결용 */}
      {phase.critic && (
        <circle
          cx={pos.width}
          cy={pos.height / 2}
          r={PORT_R}
          fill="var(--err, #e74c3c)"
          stroke="var(--err, #e74c3c)"
          strokeWidth={1.5}
          className="graph-port graph-port--goto"
          onMouseDown={(e) => { e.stopPropagation(); onPortDragStart(phase.phase_id, "goto"); }}
        />
      )}

      {/* 선택 시 편집 버튼 (모바일 터치 대응) */}
      {isSelected && (
        <g
          transform={`translate(${pos.width - 14}, ${pos.height - 14})`}
          onClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
          className="graph-edit-btn"
        >
          <circle r={10} fill="var(--accent, #89b4fa)" opacity={0.9} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fill="var(--bg, #1e1e2e)"
            style={{ pointerEvents: "none" }}
          >
            ✎
          </text>
        </g>
      )}
    </g>
  );
}

// ── Main Graph Editor Component ──

type DragState = {
  from_id: string;
  port: "out" | "goto";
  mouse: { x: number; y: number };
} | null;

// ── Zoom/Pan 상수 ──

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.15;

export function GraphEditor({
  workflow,
  onChange,
  selectedPhaseId,
  onSelectPhase,
  onEditPhase,
}: {
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  selectedPhaseId: string | null;
  onSelectPhase: (id: string | null) => void;
  onEditPhase?: (id: string) => void;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState>(null);

  /** zoom=1 → 100%, contentBox = 노드 범위 기준 viewBox. */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  /** 노드 수동 위치 오프셋 (자동 레이아웃 대비 delta). */
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const nodeDrag = useRef<{ id: string; startSvg: { x: number; y: number }; startOffset: { dx: number; dy: number }; moved: boolean } | null>(null);
  const DRAG_THRESHOLD = 5;

  const autoPositions = useMemo(() => compute_positions(workflow.phases), [workflow.phases]);
  /** 자동 레이아웃 + 수동 오프셋 합산. */
  const positions = useMemo(() => {
    const merged = new Map<string, NodePos>();
    for (const [id, pos] of autoPositions) {
      const off = nodeOffsets[id];
      merged.set(id, off ? { ...pos, x: pos.x + off.dx, y: pos.y + off.dy } : pos);
    }
    return merged;
  }, [autoPositions, nodeOffsets]);
  const edges = useMemo(() => compute_edges(workflow.phases), [workflow.phases]);

  /** 노드 전체 범위 계산. */
  const contentBox = useMemo(() => {
    let maxX = 0, maxY = 0;
    for (const pos of positions.values()) {
      maxX = Math.max(maxX, pos.x + pos.width + PADDING);
      maxY = Math.max(maxY, pos.y + pos.height + PADDING);
    }
    return { w: Math.max(maxX, 400), h: Math.max(maxY, 300) };
  }, [positions]);

  /** zoom + pan 적용된 viewBox 계산. */
  const viewBox = useMemo(() => {
    const w = contentBox.w / zoom;
    const h = contentBox.h / zoom;
    return { x: pan.x, y: pan.y, w, h };
  }, [contentBox, zoom, pan]);

  /** SVG 좌표 변환. */
  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    if (!ctm) return { x: clientX, y: clientY };
    const svgPt = pt.matrixTransform(ctm);
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  /** 노드 드래그 시작. */
  const handleNodeDragStart = useCallback((phase_id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pt = svgPoint(e.clientX, e.clientY);
    const off = nodeOffsets[phase_id] || { dx: 0, dy: 0 };
    nodeDrag.current = { id: phase_id, startSvg: pt, startOffset: off, moved: false };
  }, [svgPoint, nodeOffsets]);

  /** 포트 드래그 시작. */
  const handlePortDragStart = useCallback((phase_id: string, port: "out" | "goto") => {
    const pos = positions.get(phase_id);
    if (!pos) return;
    const startY = port === "goto" ? pos.y + pos.height / 2 : pos.y + pos.height;
    const startX = port === "goto" ? pos.x + pos.width : pos.x + pos.width / 2;
    setDrag({ from_id: phase_id, port, mouse: { x: startX, y: startY } });
  }, [positions]);

  /** 휠 줌 — native listener로 등록해야 preventDefault 동작. */
  const wheelHandler = useRef<(e: WheelEvent) => void>(undefined);
  wheelHandler.current = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pivot = svgPoint(e.clientX, e.clientY);
    setZoom((prev) => {
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev + dir * ZOOM_STEP));
      const scale = next / prev;
      setPan((p) => ({
        x: pivot.x - (pivot.x - p.x) / scale,
        y: pivot.y - (pivot.y - p.y) / scale,
      }));
      return next;
    });
  };
  /** 터치 상태 (핀치 줌 + 원터치 팬). */
  const touchState = useRef<{ lastDist: number; lastCenter: { x: number; y: number }; fingers: number }>({
    lastDist: 0, lastCenter: { x: 0, y: 0 }, fingers: 0,
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // 휠 줌
    const onWheel = (e: WheelEvent) => wheelHandler.current?.(e);
    svg.addEventListener("wheel", onWheel, { passive: false });

    // 터치 핸들러
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        touchState.current = {
          lastDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          lastCenter: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
          fingers: 2,
        };
      } else if (e.touches.length === 1) {
        touchState.current = {
          lastDist: 0,
          lastCenter: { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY },
          fingers: 1,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchState.current;
      if (e.touches.length === 2 && ts.fingers === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const ratio = dist / (ts.lastDist || 1);
        setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * ratio)));
        ts.lastDist = dist;
      } else if (e.touches.length === 1 && ts.fingers === 1) {
        const dx = e.touches[0]!.clientX - ts.lastCenter.x;
        const dy = e.touches[0]!.clientY - ts.lastCenter.y;
        const rect = svg.getBoundingClientRect();
        const cw = svg.viewBox.baseVal.width;
        const ch = svg.viewBox.baseVal.height;
        setPan((p) => ({
          x: p.x - dx * (cw / rect.width),
          y: p.y - dy * (ch / rect.height),
        }));
        ts.lastCenter = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      }
    };

    const onTouchEnd = () => { touchState.current.fingers = 0; };

    svg.addEventListener("touchstart", onTouchStart, { passive: false });
    svg.addEventListener("touchmove", onTouchMove, { passive: false });
    svg.addEventListener("touchend", onTouchEnd);

    return () => {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("touchstart", onTouchStart);
      svg.removeEventListener("touchmove", onTouchMove);
      svg.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  /** 캔버스 팬: 빈 영역 드래그. */
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (drag) return; // 포트 드래그 중이면 무시
    if ((e.target as Element).closest(".graph-port")) return;
    if ((e.target as Element).closest("g[style]")) return; // 노드 클릭
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [drag, pan]);

  /** 드래그 중 마우스 이동 (팬 + 포트 드래그). */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      setPan({
        x: panStart.current.panX - (e.clientX - panStart.current.x) * scaleX,
        y: panStart.current.panY - (e.clientY - panStart.current.y) * scaleY,
      });
      return;
    }
    if (!drag) return;
    const pt = svgPoint(e.clientX, e.clientY);
    setDrag({ ...drag, mouse: pt });
  }, [drag, isPanning, svgPoint, viewBox.w, viewBox.h]);

  /** 드롭: 대상 노드 위에서 마우스 업 + 팬 종료. */
  const handleMouseUp = useCallback(() => {
    if (isPanning) { setIsPanning(false); return; }
    if (!drag) return;
    // 마우스 위치에서 가장 가까운 노드의 입력 포트 탐지
    let target_id: string | null = null;
    let min_dist = 30; // 최소 거리 threshold
    for (const [id, pos] of positions) {
      if (id === drag.from_id) continue;
      const inX = pos.x + pos.width / 2;
      const inY = pos.y;
      const dist = Math.hypot(drag.mouse.x - inX, drag.mouse.y - inY);
      if (dist < min_dist) {
        min_dist = dist;
        target_id = id;
      }
    }

    if (target_id) {
      const phases = workflow.phases.map((p) => ({ ...p }));
      if (drag.port === "out") {
        // flow 엣지: target의 depends_on에 추가
        const target = phases.find((p) => p.phase_id === target_id);
        if (target) {
          const deps = new Set(target.depends_on || []);
          deps.add(drag.from_id);
          target.depends_on = [...deps];
        }
      } else {
        // goto 엣지: source의 critic.goto_phase 설정
        const source = phases.find((p) => p.phase_id === drag.from_id);
        if (source?.critic) {
          source.critic = { ...source.critic, on_rejection: "goto", goto_phase: target_id };
        }
      }
      onChange({ ...workflow, phases });
    }
    setDrag(null);
  }, [drag, isPanning, positions, workflow, onChange]);

  const addPhase = () => {
    const idx = workflow.phases.length;
    const newPhase: PhaseDef = {
      phase_id: `phase-${idx + 1}`,
      title: `Phase ${idx + 1}`,
      agents: [{ agent_id: `agent-1`, role: "", label: "", backend: "openrouter", system_prompt: "", max_turns: 3 }],
    };
    if (idx > 0) {
      newPhase.depends_on = [workflow.phases[idx - 1]!.phase_id];
    }
    onChange({ ...workflow, phases: [...workflow.phases, newPhase] });
  };

  /** 드래그 시작점 좌표. */
  const dragStartPos = useMemo(() => {
    if (!drag) return null;
    const pos = positions.get(drag.from_id);
    if (!pos) return null;
    return drag.port === "goto"
      ? { x: pos.x + pos.width, y: pos.y + pos.height / 2 }
      : { x: pos.x + pos.width / 2, y: pos.y + pos.height };
  }, [drag, positions]);

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomPercent = Math.round(zoom * 100);

  /** Aggregator: depends_on >= 2인 노드 앞에 다이아몬드 합류점 표시. */
  const aggregators = useMemo(() => {
    const result: { x: number; y: number; phase_id: string }[] = [];
    for (const phase of workflow.phases) {
      if (!phase.depends_on || phase.depends_on.length < 2) continue;
      const pos = positions.get(phase.phase_id);
      if (!pos) continue;
      result.push({ x: pos.x + pos.width / 2, y: pos.y - 16, phase_id: phase.phase_id });
    }
    return result;
  }, [workflow.phases, positions]);

  return (
    <div className="graph-editor">
      <div className="graph-editor__toolbar">
        <button className="btn btn--sm" onClick={addPhase}>
          + {t("workflows.add_phase")}
        </button>
        <span className="graph-editor__toolbar-sep" />
        <button className="btn btn--sm btn--icon" onClick={zoomOut} title="Zoom out">−</button>
        <span className="graph-editor__zoom-label">{zoomPercent}%</span>
        <button className="btn btn--sm btn--icon" onClick={zoomIn} title="Zoom in">+</button>
        <button className="btn btn--sm" onClick={zoomReset} title="Reset zoom">⌂</button>
      </div>

      <svg
        ref={svgRef}
        className={`graph-editor__canvas${isPanning ? " graph-editor__canvas--panning" : ""}`}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDrag(null); setIsPanning(false); }}
      >
        <defs>
          <marker id="arrow-flow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line, #555)" />
          </marker>
          <marker id="arrow-goto" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--err, #e74c3c)" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => (
          <EdgePath key={`${edge.from}-${edge.to}-${i}`} {...edge} positions={positions} />
        ))}

        {/* Aggregator 다이아몬드 (Fork-Join 합류점) */}
        {aggregators.map((agg) => (
          <g key={`agg-${agg.phase_id}`} transform={`translate(${agg.x}, ${agg.y})`}>
            <polygon
              points="0,-8 8,0 0,8 -8,0"
              fill="var(--accent, #89b4fa)"
              opacity={0.3}
              stroke="var(--accent, #89b4fa)"
              strokeWidth={1.5}
            />
          </g>
        ))}

        {/* 드래그 중인 선 미리보기 */}
        {drag && dragStartPos && (
          <line
            x1={dragStartPos.x}
            y1={dragStartPos.y}
            x2={drag.mouse.x}
            y2={drag.mouse.y}
            stroke={drag.port === "goto" ? "var(--err, #e74c3c)" : "var(--accent, #89b4fa)"}
            strokeWidth={2}
            strokeDasharray={drag.port === "goto" ? "6 4" : "4 2"}
            opacity={0.7}
            pointerEvents="none"
          />
        )}

        {/* Nodes */}
        {workflow.phases.map((phase) => {
          const pos = positions.get(phase.phase_id);
          if (!pos) return null;
          return (
            <PhaseNode
              key={phase.phase_id}
              phase={phase}
              pos={pos}
              isSelected={selectedPhaseId === phase.phase_id}
              onClick={() => onSelectPhase(selectedPhaseId === phase.phase_id ? null : phase.phase_id)}
              onDoubleClick={() => onEditPhase?.(phase.phase_id)}
              onPortDragStart={handlePortDragStart}
            />
          );
        })}
      </svg>
    </div>
  );
}
