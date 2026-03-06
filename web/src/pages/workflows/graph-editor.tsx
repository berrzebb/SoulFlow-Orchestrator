/**
 * Graph Editor — SVG 기반 노드-엣지 워크플로우 편집기.
 * 메인 뷰: 노드(Phase) 배치 + 엣지(depends_on, goto) 연결.
 * 노드 클릭 → 인라인 프로퍼티 패널, 드래그로 위치 조정.
 */

import { useState, useRef, useEffect } from "react";
import { useT } from "../../i18n";
import { get_output_fields, get_input_fields, PHASE_OUTPUT, PHASE_INPUT, TRIGGER_OUTPUT, CHANNEL_OUTPUT, CHANNEL_INPUT, FIELD_TYPE_COLORS, type OutputField } from "./output-schema";
import { get_frontend_node } from "./node-registry";
import { NodePicker } from "./node-picker";
import type { NodePreset } from "./node-presets";

// ── Types (workflow-types.ts에서 re-export) ──
export type { AgentDef, CriticDef, PhaseDef, OrcheNodeType, OrcheNodeDef, NodeGroup, WorkflowDef, NodeType, SubNodeType, ToolNodeDef, SkillNodeDef, TriggerType, TriggerNodeDef, FieldMapping, GraphNode } from "./workflow-types";
import type { PhaseDef, OrcheNodeDef, NodeGroup, WorkflowDef, NodeType, SubNodeType, TriggerType, TriggerNodeDef, GraphNode } from "./workflow-types";

// ── Layout ──

type NodePos = { x: number; y: number; width: number; height: number };

const NODE_W = 200;
const NODE_H = 72;
const AUX_W = 140;
const GAP_X = 120; // 레이어 간 가로 간격
const GAP_Y = 40;  // 같은 레이어 내 세로 간격
const PADDING = 40;
const SUB_D = 40;         // 클러스터 Sub-node 지름
const SUB_GAP = 12;       // Sub-node 간 간격
const SUB_OFFSET_Y = 24;  // Phase 하단으로부터의 거리

// ── 필드 포트 레이아웃 상수 ──
const FIELD_PORT_R = 4;       // 필드 포트 반지름
const FIELD_PORT_H = 18;      // 필드 포트 1개당 높이
const FIELD_PORT_TOP = 32;    // 첫 필드 포트의 Y 오프셋 (노드 상단 기준)
const ORCHE_MIN_H = 60;       // 오케 노드 최소 높이

/** 출력 필드 수에 따라 오케 노드 높이 계산. */
function compute_orche_node_height(field_count: number): number {
  return Math.max(ORCHE_MIN_H, FIELD_PORT_TOP + field_count * FIELD_PORT_H + 12);
}

/** Topological layer 할당: depends_on 기반 + 암묵적 순차 배치. */
function compute_layers(phases: PhaseDef[]): Map<string, number> {
  const layers = new Map<string, number>();
  const id_set = new Set(phases.map((p) => p.phase_id));
  const has_explicit_deps = new Set<string>();

  function get_layer(id: string, visited: Set<string>): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const phase = phases.find((p) => p.phase_id === id);
    const deps = phase?.depends_on?.filter((d) => id_set.has(d)) || [];
    if (!deps.length) return -1; // 아직 미결정 — 암묵적 순서로 배치
    has_explicit_deps.add(id);
    const max_dep = Math.max(...deps.map((d) => get_layer(d, visited)));
    const layer = (max_dep < 0 ? 0 : max_dep) + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const p of phases) get_layer(p.phase_id, new Set());

  // depends_on이 없는 Phase는 YAML 순서대로 순차 레이어 배치
  let seq = 0;
  for (const p of phases) {
    if (!has_explicit_deps.has(p.phase_id)) {
      layers.set(p.phase_id, seq);
      seq++;
    } else {
      seq = Math.max(seq, layers.get(p.phase_id)! + 1);
    }
  }

  return layers;
}

/** Phase의 Sub-node를 포함한 유효 높이: Phase + 슬롯 + Sub-node. */
function phase_effective_height(phase: PhaseDef): number {
  const sub_count = phase.agents.length + (phase.critic ? 1 : 0);
  return sub_count > 0 ? NODE_H + SUB_OFFSET_Y + SUB_D : NODE_H;
}

/** 노드 위치 계산 — 좌→우 가로 흐름. 레이어가 x축, 같은 레이어 노드는 y축 나열. */
function compute_positions(phases: PhaseDef[]): Map<string, NodePos> {
  const layers = compute_layers(phases);
  const positions = new Map<string, NodePos>();
  const phase_map = new Map(phases.map((p) => [p.phase_id, p]));

  const layer_groups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    if (!layer_groups.has(layer)) layer_groups.set(layer, []);
    layer_groups.get(layer)!.push(id);
  }

  // 레이어별 유효 높이 합산 (Sub-node 포함)
  const layer_heights = new Map<number, number>();
  for (const [layer, ids] of layer_groups) {
    const total = ids.reduce((sum, id) => sum + phase_effective_height(phase_map.get(id)!), 0) + (ids.length - 1) * GAP_Y;
    layer_heights.set(layer, total);
  }
  const max_h = Math.max(1, ...layer_heights.values());
  const max_layer = Math.max(0, ...layer_groups.keys());

  for (let layer = 0; layer <= max_layer; layer++) {
    const ids = layer_groups.get(layer) || [];
    const total_h = layer_heights.get(layer) || 0;
    const offset_y = (max_h - total_h) / 2;

    let cum_y = 0;
    ids.forEach((id) => {
      positions.set(id, {
        x: PADDING + layer * (NODE_W + GAP_X),
        y: PADDING + offset_y + cum_y,
        width: NODE_W,
        height: NODE_H,
      });
      cum_y += phase_effective_height(phase_map.get(id)!) + GAP_Y;
    });
  }

  return positions;
}

/** 보조 노드 + 클러스터 Sub-node 위치 계산. */
function compute_aux_positions(
  workflow: WorkflowDef,
  phase_positions: Map<string, NodePos>,
): { nodes: GraphNode[]; positions: Map<string, NodePos> } {
  const nodes: GraphNode[] = [];
  const positions = new Map<string, NodePos>();
  const tool_nodes = workflow.tool_nodes || [];
  const skill_nodes = workflow.skill_nodes || [];

  // 클러스터 Sub-node: Phase 하단에 Agent/Critic/Tool/Skill 배치
  for (const phase of workflow.phases) {
    const pp = phase_positions.get(phase.phase_id);
    if (!pp) continue;

    const sub_items: { id: string; sub_type: SubNodeType; label: string }[] = [
      ...phase.agents.map((a) => ({ id: `${phase.phase_id}__${a.agent_id}`, sub_type: "agent" as const, label: a.label || a.agent_id })),
      ...(phase.critic ? [{ id: `${phase.phase_id}__critic`, sub_type: "critic" as const, label: "Critic" }] : []),
      ...tool_nodes.filter((t) => t.attach_to?.includes(phase.phase_id)).map((t) => ({ id: `${phase.phase_id}__tool_${t.id}`, sub_type: "tool" as const, label: t.tool_id })),
      ...skill_nodes.filter((s) => s.attach_to?.includes(phase.phase_id)).map((s) => ({ id: `${phase.phase_id}__skill_${s.id}`, sub_type: "skill" as const, label: s.skill_name })),
    ];
    if (!sub_items.length) continue;

    const total_w = sub_items.length * SUB_D + (sub_items.length - 1) * SUB_GAP;
    const start_x = pp.x + (pp.width - total_w) / 2;
    const y = pp.y + pp.height + SUB_OFFSET_Y;

    sub_items.forEach((item, i) => {
      nodes.push({ id: item.id, type: "sub_node", label: item.label, sub_type: item.sub_type, parent_phase_id: phase.phase_id });
      positions.set(item.id, { x: start_x + i * (SUB_D + SUB_GAP), y, width: SUB_D, height: SUB_D });
    });
  }

  // Trigger 노드 배치 (trigger_nodes[] 또는 레거시 trigger 필드)
  const effective_triggers: TriggerNodeDef[] = workflow.trigger_nodes?.length
    ? workflow.trigger_nodes
    : workflow.trigger?.type === "cron"
      ? [{ id: "__cron__", trigger_type: "cron" as const, schedule: workflow.trigger.schedule, timezone: workflow.trigger.timezone }]
      : [];
  const trigger_out = TRIGGER_OUTPUT;
  const trigger_w = 160, trigger_h = compute_orche_node_height(trigger_out.length);
  effective_triggers.forEach((tn, ti) => {
    const first_phase = workflow.phases[0];
    const anchor = first_phase ? phase_positions.get(first_phase.phase_id) : null;
    const x = anchor ? anchor.x - trigger_w - GAP_X : PADDING;
    const y = anchor ? anchor.y + ti * (trigger_h + GAP_Y) : PADDING + ti * (trigger_h + GAP_Y);
    const label = tn.trigger_type === "cron" ? (tn.schedule || "cron") : tn.trigger_type;
    const trigger_detail = tn.trigger_type === "cron" ? tn.schedule
      : tn.trigger_type === "webhook" ? tn.webhook_path
      : undefined;
    nodes.push({ id: tn.id, type: "trigger", label, sub_label: tn.trigger_type, output_fields: trigger_out, trigger_detail });
    positions.set(tn.id, { x, y, width: trigger_w, height: trigger_h });
  });

  // 오케스트레이션 노드 → depends_on 기반으로 위치 계산
  const orche_nodes = workflow.orche_nodes || [];
  const all_positions = new Map(phase_positions);
  // 앵커별 배치된 자식 수 추적 (겹침 방지)
  const anchor_child_count = new Map<string, number>();
  let unanchored_idx = 0;
  for (const on of orche_nodes) {
    const orche_type = on.node_type as NodeType;
    const is_diamond = orche_type === "if" || orche_type === "merge";
    const fields = get_output_fields(on);
    const inputs = get_input_fields(on);
    const w = is_diamond ? 120 : 200;
    const h = is_diamond ? 80 : compute_orche_node_height(Math.max(fields.length, inputs.length));
    nodes.push({ id: on.node_id, type: orche_type, label: on.title || on.node_id, orche_data: on, input_fields: inputs, output_fields: fields });

    // depends_on에서 앵커 탐색
    let anchor: NodePos | null = null;
    let anchor_id: string | null = null;
    for (const dep of on.depends_on || []) {
      const pos = all_positions.get(dep);
      if (pos) { anchor = pos; anchor_id = dep; break; }
    }

    if (anchor && anchor_id) {
      const child_idx = anchor_child_count.get(anchor_id) || 0;
      anchor_child_count.set(anchor_id, child_idx + 1);
      const y_offset = child_idx * (h + GAP_Y);
      const placed = { x: anchor.x + anchor.width + GAP_X, y: anchor.y + y_offset, width: w, height: h };
      positions.set(on.node_id, placed);
      all_positions.set(on.node_id, placed);
    } else {
      const max_y = Math.max(PADDING, ...[...phase_positions.values()].map((p) => p.y + p.height));
      const placed = {
        x: PADDING + unanchored_idx * (w + GAP_X),
        y: max_y + GAP_Y * 2,
        width: w, height: h,
      };
      positions.set(on.node_id, placed);
      all_positions.set(on.node_id, placed);
      unanchored_idx++;
    }
  }

  // Channel 노드 → 마지막 Phase 우측 위에 배치
  if (workflow.hitl_channel) {
    const last_phase = workflow.phases[workflow.phases.length - 1];
    const anchor = last_phase ? phase_positions.get(last_phase.phase_id) : null;
    const x = anchor ? anchor.x + anchor.width + 40 : PADDING + NODE_W + 40;
    const y = anchor ? anchor.y - 40 : PADDING;
    const ch_inputs = CHANNEL_INPUT;
    const ch_outputs = CHANNEL_OUTPUT;
    const ch_h = compute_orche_node_height(Math.max(ch_inputs.length, ch_outputs.length));
    nodes.push({ id: "__channel__", type: "channel", label: workflow.hitl_channel.channel_type, sub_label: workflow.hitl_channel.chat_id, input_fields: ch_inputs, output_fields: ch_outputs });
    positions.set("__channel__", { x, y, width: AUX_W, height: ch_h });
  }

  return { nodes, positions };
}

/** 보조 엣지 계산 (클러스터 attach + 오케 flow + trigger/config + field mapping). */
function compute_aux_edges(workflow: WorkflowDef): Edge[] {
  const edges: Edge[] = [];

  // 클러스터 Sub-node 엣지: Phase → Agent/Critic/Tool/Skill
  for (const phase of workflow.phases) {
    for (const a of phase.agents) {
      edges.push({ from: phase.phase_id, to: `${phase.phase_id}__${a.agent_id}`, type: "attach" });
    }
    if (phase.critic) {
      edges.push({ from: phase.phase_id, to: `${phase.phase_id}__critic`, type: "attach" });
    }
    for (const tn of workflow.tool_nodes || []) {
      if (tn.attach_to?.includes(phase.phase_id)) {
        edges.push({ from: phase.phase_id, to: `${phase.phase_id}__tool_${tn.id}`, type: "attach" });
      }
    }
    for (const sn of workflow.skill_nodes || []) {
      if (sn.attach_to?.includes(phase.phase_id)) {
        edges.push({ from: phase.phase_id, to: `${phase.phase_id}__skill_${sn.id}`, type: "attach" });
      }
    }
  }

  // 오케스트레이션 노드의 depends_on 엣지
  for (const on of workflow.orche_nodes || []) {
    for (const dep of on.depends_on || []) {
      edges.push({ from: dep, to: on.node_id, type: "flow" });
    }
  }

  // Trigger → 첫 번째 Phase
  const eff_triggers: TriggerNodeDef[] = workflow.trigger_nodes?.length
    ? workflow.trigger_nodes
    : workflow.trigger?.type === "cron" && workflow.phases[0]
      ? [{ id: "__cron__", trigger_type: "cron" as const, schedule: workflow.trigger.schedule }]
      : [];
  for (const tn of eff_triggers) {
    if (workflow.phases[0]) {
      edges.push({ from: tn.id, to: workflow.phases[0].phase_id, type: "trigger", from_port: "payload", to_port: "prompt" });
    }
  }

  // Channel → interactive/sequential_loop Phase
  if (workflow.hitl_channel) {
    for (const p of workflow.phases) {
      if (p.mode === "interactive" || p.mode === "sequential_loop") {
        edges.push({ from: "__channel__", to: p.phase_id, type: "config", to_port: "channel" });
      }
    }
  }

  // 필드 매핑 엣지 (from_port/to_port 포함)
  for (const m of workflow.field_mappings || []) {
    edges.push({ from: m.from_node, to: m.to_node, from_port: m.from_field, to_port: m.to_field, type: "mapping", label: m.from_field });
  }

  return edges;
}

// ── Edge types ──

type EdgeType = "flow" | "goto" | "attach" | "trigger" | "config" | "mapping";

type Edge = {
  from: string;
  to: string;
  from_port?: string;
  to_port?: string;
  type: EdgeType;
  label?: string;
};

function compute_edges(phases: PhaseDef[]): Edge[] {
  const edges: Edge[] = [];
  const id_set = new Set(phases.map((p) => p.phase_id));

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;

    // depends_on 엣지 (result 출력 → prompt 입력)
    if (phase.depends_on?.length) {
      for (const dep of phase.depends_on) {
        if (id_set.has(dep)) edges.push({ from: dep, to: phase.phase_id, type: "flow", from_port: "result", to_port: "prompt" });
      }
    } else if (i > 0) {
      edges.push({ from: phases[i - 1]!.phase_id, to: phase.phase_id, type: "flow", from_port: "result", to_port: "prompt" });
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

// ── SVG Edge Renderer ──

function EdgePath({ from, to, from_port, to_port, positions, type, label, onDelete, onInsert, graphNodes, phases }: Edge & {
  positions: Map<string, NodePos>; onDelete?: () => void;
  onInsert?: (from_id: string, to_id: string) => void;
  graphNodes?: GraphNode[]; phases?: PhaseDef[];
}) {
  const p1 = positions.get(from);
  const p2 = positions.get(to);
  if (!p1 || !p2) return null;

  // 포트 Y 오프셋 계산: 포트 이름 → 필드 인덱스, 없으면 첫 번째 포트 위치
  const resolvePortY = (nodeId: string, portName: string | undefined, side: "out" | "in", pos: NodePos): number => {
    const phase = phases?.find((p) => p.phase_id === nodeId);
    const gn = graphNodes?.find((n) => n.id === nodeId);
    const fields = side === "out"
      ? (phase ? (PHASE_OUTPUT) : (gn?.output_fields || []))
      : (phase ? (PHASE_INPUT) : (gn?.input_fields || []));
    if (portName) {
      const idx = fields.findIndex((f) => f.name === portName);
      return idx >= 0 ? FIELD_PORT_TOP + idx * FIELD_PORT_H : pos.height / 2;
    }
    // 포트 이름 없으면 첫 번째 포트 위치 (필드가 있을 때)
    return fields.length > 0 ? FIELD_PORT_TOP : pos.height / 2;
  };

  // 좌→우 흐름: 출력 = 우측, 입력 = 좌측
  const x1 = p1.x + p1.width;
  const x2 = p2.x;
  // 모든 엣지: 포트 위치 기반 Y 좌표
  const y1 = p1.y + resolvePortY(from, from_port, "out", p1);
  const y2 = p2.y + resolvePortY(to, to_port, "in", p2);

  if (type === "goto") {
    // goto: 아래로 우회하는 커브 (역방향 가능)
    const belowY = Math.max(p1.y + p1.height, p2.y + p2.height) + 50;
    const d = `M ${p1.x + p1.width / 2} ${p1.y + p1.height} C ${p1.x + p1.width / 2} ${belowY}, ${p2.x + p2.width / 2} ${belowY}, ${p2.x + p2.width / 2} ${p2.y + p2.height}`;
    const labelX = (p1.x + p2.x) / 2 + NODE_W / 2;
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
            x={labelX}
            y={belowY - 6}
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

  // attach: Phase → Sub-node (클러스터 연결: 세로 직선)
  if (type === "attach") {
    const sx = p1.x + p1.width / 2;
    const sy = p1.y + p1.height;
    const ex = p2.x + p2.width / 2;
    const ey = p2.y;
    // Sub-node가 Phase 바로 아래면 단순 직선, 아니면 커브
    const isVertical = Math.abs(sx - ex) < p1.width;
    if (isVertical) {
      return <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--muted, #6c7086)" strokeWidth={1} strokeDasharray="3 3" />;
    }
    const midY = (sy + ey) / 2;
    const d = `M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`;
    return (
      <path d={d} fill="none" stroke="var(--muted, #6c7086)" strokeWidth={1.2}
        strokeDasharray="3 3" />
    );
  }

  // trigger: Cron → Phase (주황 대시선)
  if (type === "trigger") {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return (
      <path d={d} fill="none" stroke="var(--orange, #e67e22)" strokeWidth={1.5}
        strokeDasharray="8 4" markerEnd="url(#arrow-trigger)" />
    );
  }

  // config: Channel → Phase (노란 대시선)
  if (type === "config") {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return (
      <path d={d} fill="none" stroke="var(--yellow, #f1c40f)" strokeWidth={1.2}
        strokeDasharray="5 3" markerEnd="url(#arrow-config)" />
    );
  }

  // mapping: 필드 매핑 (보라색 점선)
  if (type === "mapping") {
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return (
      <g className={onDelete ? "graph-edge graph-edge--deletable" : "graph-edge"}>
        {onDelete && <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} onClick={onDelete} />}
        <path d={d} fill="none" stroke="#9b59b6" strokeWidth={1.5}
          strokeDasharray="4 3" markerEnd="url(#arrow-mapping)" pointerEvents="none" />
        {label && (
          <text x={midX} y={Math.min(y1, y2) - 4} textAnchor="middle" fill="#9b59b6" fontSize={9} fontWeight={600} pointerEvents="none">
            {label}
          </text>
        )}
      </g>
    );
  }

  // flow: 가로 부드러운 커브 (우측→좌측)
  const midX = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  // bezier 중점 근사: t=0.5 → (x1+3*midX+3*midX+x2)/8, (y1+3*y1+3*y2+y2)/8
  const edgeMidX = (x1 + x2) / 2;
  const edgeMidY = (y1 + y2) / 2;
  return (
    <g className={onDelete ? "graph-edge graph-edge--deletable" : "graph-edge"}>
      {/* 투명 히트 영역 (클릭 감지용) */}
      {onDelete && <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} onClick={onDelete} />}
      <path d={d} fill="none" stroke="var(--line, #555)" strokeWidth={1.5} markerEnd="url(#arrow-flow)" pointerEvents="none" />
      {/* 엣지 중간 + 삽입 버튼 */}
      {onInsert && (
        <g className="graph-edge-add"
          transform={`translate(${edgeMidX}, ${edgeMidY})`}
          onClick={(e) => { e.stopPropagation(); onInsert(from, to); }}
          style={{ cursor: "pointer" }}
        >
          <circle r={10} fill="var(--panel, #1e1e2e)" stroke="var(--accent, #89b4fa)" strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={14} fill="var(--accent, #89b4fa)" pointerEvents="none">+</text>
        </g>
      )}
    </g>
  );
}

// ── Port Layout Helpers ──

const PORT_R = 6;

/** 입력 포트 목록 (좌측). */
function InputPorts({ fields }: { fields: OutputField[] }) {
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((field, i) => {
        const fy = FIELD_PORT_TOP + i * FIELD_PORT_H;
        return (
          <g key={`in-${field.name}`}>
            <text x={12} y={fy + 4} fill="var(--muted, #6c7086)" fontSize={9}>{field.name}</text>
            <rect x={-5} y={fy - 5} width={10} height={10} rx={5}
              fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5}
              className="graph-port graph-port--in"
            >
              <title>{field.name}: {field.type}{field.description ? ` — ${field.description}` : ""}</title>
            </rect>
          </g>
        );
      })}
    </>
  );
}

/** 출력 포트 목록 (우측). */
function OutputPorts({ fields, nodeWidth, nodeId, onFieldDragStart }: {
  fields: OutputField[];
  nodeWidth: number;
  nodeId: string;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((field, i) => {
        const fy = FIELD_PORT_TOP + i * FIELD_PORT_H;
        const fc = FIELD_TYPE_COLORS[field.type] || "#95a5a6";
        return (
          <g key={`out-${field.name}`}>
            <text x={nodeWidth - 16} y={fy + 4} textAnchor="end" fill="var(--muted, #6c7086)" fontSize={9}>
              {field.name.length > 14 ? field.name.slice(0, 14) + "…" : field.name}
            </text>
            <circle cx={nodeWidth} cy={fy} r={14} fill="transparent"
              className="graph-port graph-port--field" data-port-name={field.name}
              style={{ cursor: "crosshair" }}
              onMouseDown={onFieldDragStart ? (e) => { e.stopPropagation(); onFieldDragStart(nodeId, field.name, e); } : undefined}
            />
            <circle cx={nodeWidth} cy={fy} r={FIELD_PORT_R} fill={fc} stroke={fc} strokeWidth={1} pointerEvents="none">
              <title>{field.name}: {field.type}{field.description ? ` — ${field.description}` : ""}</title>
            </circle>
          </g>
        );
      })}
    </>
  );
}


// ── Phase Node ──

function PhaseNode({
  phase, pos, isSelected, isRunning, onClick, onDoubleClick, onPortDragStart, onNodeDragStart, onNodeTouchStart, onRunNode, subSlotCount,
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
  onRunNode?: (id: string, mode: "run" | "test") => void;
  /** 하단 클러스터 슬롯 수 (Agent + Critic + Tool + Skill). */
  subSlotCount?: number;
}) {
  const mode = phase.mode || "parallel";
  const borderColor = isRunning ? "var(--accent, #89b4fa)" : isSelected ? "var(--accent)" : "var(--line, #444)";
  const slots = subSlotCount || 0;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      data-node-id={phase.phase_id}
      className="graph-node"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={(e) => { if (!(e.target as Element).closest(".graph-port")) onNodeDragStart(phase.phase_id, e); }}
      onTouchStart={(e) => {
        if (e.touches.length === 1 && !(e.target as Element).closest(".graph-port")) {
          onNodeTouchStart(phase.phase_id, e.touches[0]!);
        }
      }}
      style={{ cursor: "pointer" }}
    >
      {/* 선택 글로우 */}
      {isSelected && !isRunning && (
        <rect
          x={-3} y={-3}
          width={pos.width + 6} height={pos.height + 6}
          rx={19}
          fill="none"
          stroke="var(--accent, #89b4fa)"
          strokeWidth={1.5}
          opacity={0.5}
          strokeDasharray="6 3"
        />
      )}
      {/* 실행 중 글로우 이펙트 */}
      {isRunning && (
        <rect
          x={-4} y={-4}
          width={pos.width + 8} height={pos.height + 8}
          rx={20}
          fill="none"
          stroke="var(--accent, #89b4fa)"
          strokeWidth={2}
          opacity={0.6}
          className="node-running-glow"
        />
      )}
      <rect
        width={pos.width}
        height={pos.height}
        rx={16}
        fill={isSelected ? "color-mix(in srgb, var(--accent, #89b4fa) 8%, var(--panel, #1e1e2e))" : "var(--panel, #1e1e2e)"}
        stroke={borderColor}
        strokeWidth={isRunning ? 2.5 : isSelected ? 2.5 : 1}
      />
      {/* 아이콘 원 (좌측, accent 컬러 — 컬러바 대체) */}
      <circle cx={24} cy={20} r={15} fill="var(--accent, #89b4fa)" opacity={0.15} />
      <circle cx={24} cy={20} r={15} fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={1.2} opacity={0.4} />
      <text x={24} y={24} textAnchor="middle" fontSize={12}>⚙</text>

      {/* Phase 제목 */}
      <text
        x={46}
        y={16}
        fill="var(--text, #cdd6f4)"
        fontSize={13}
        fontWeight={600}
      >
        {(phase.title || phase.phase_id).length > 14 ? (phase.title || phase.phase_id).slice(0, 14) + "…" : (phase.title || phase.phase_id)}
      </text>

      {/* 부제: Agent 수 + mode */}
      <text
        x={46}
        y={28}
        fill="var(--muted, #6c7086)"
        fontSize={9}
      >
        {phase.agents.length} agent{phase.agents.length !== 1 ? "s" : ""}
        {phase.critic ? " · critic" : ""}
        {mode !== "parallel" ? ` · ${MODE_ICON[mode]}` : ""}
      </text>

      {/* depends_on 표시 */}
      {phase.depends_on?.length ? (
        <text
          x={46}
          y={40}
          fill="var(--muted, #6c7086)"
          fontSize={8}
          opacity={0.7}
        >
          ← {phase.depends_on.join(", ")}
        </text>
      ) : null}

      {/* 포트 영역 구분선 */}
      <line x1={10} y1={FIELD_PORT_TOP - 4} x2={pos.width - 10} y2={FIELD_PORT_TOP - 4} stroke="var(--line, #555)" strokeWidth={0.5} opacity={0.4} />

      {/* 입력 포트들 (좌측) */}
      <InputPorts fields={get_input_fields(phase)} />

      {/* 출력 포트들 (우측) */}
      <OutputPorts fields={get_output_fields(phase)} nodeWidth={pos.width} nodeId={phase.phase_id}
        onFieldDragStart={(_, fieldName) => onPortDragStart(phase.phase_id, fieldName)} />

      {/* 하단 클러스터 슬롯 포트 (다이아몬드) */}
      {slots > 0 && (() => {
        const slot_gap = Math.min(20, (pos.width - 24) / slots);
        const start_x = (pos.width - (slots - 1) * slot_gap) / 2;
        return Array.from({ length: slots }, (_, i) => {
          const sx = start_x + i * slot_gap;
          return (
            <polygon
              key={`slot-${i}`}
              points={`${sx},${pos.height - 4} ${sx + 4},${pos.height} ${sx},${pos.height + 4} ${sx - 4},${pos.height}`}
              fill="var(--muted, #6c7086)"
              opacity={0.5}
            />
          );
        });
      })()}

      {/* ▶ Play 버튼 (Mode 뱃지 왼쪽) */}
      {onRunNode && (
        <g
          transform={`translate(${pos.width - 46}, 15)`}
          onClick={(e) => { e.stopPropagation(); onRunNode(phase.phase_id, e.shiftKey ? "test" : "run"); }}
          style={{ cursor: "pointer" }}
          className="graph-play-btn"
        >
          <circle r={9} fill="var(--accent, #89b4fa)" opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={10} fill="var(--accent, #89b4fa)" style={{ pointerEvents: "none" }}>▶</text>
        </g>
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

// ── Auxiliary Node Components ──

const SUB_COLORS: Record<string, string> = { agent: "#3498db", critic: "#e74c3c", tool: "#6c7086", skill: "#27ae60" };
const SUB_ICONS: Record<string, string> = { agent: "🤖", critic: "⚖", tool: "🔧", skill: "⚡" };

/** 클러스터 Sub-node: n8n 스타일 원형 (r=18). Phase 하단에 배치. */
function ClusterSubNode({ node, pos, onDoubleClick }: {
  node: GraphNode; pos: NodePos;
  onDoubleClick?: () => void;
}) {
  const color = SUB_COLORS[node.sub_type || "agent"] || "#888";
  const icon = SUB_ICONS[node.sub_type || "agent"] || "?";
  const r = pos.width / 2;
  const cx = r, cy = r;
  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      style={{ cursor: "pointer" }}
    >
      <circle cx={cx} cy={cy} r={r - 2} fill="var(--panel, #1e1e2e)" stroke={color} strokeWidth={1.5} />
      <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central" fontSize={14}>{icon}</text>
      <text x={cx} y={cy + r + 10} textAnchor="middle" fill="var(--muted, #6c7086)" fontSize={8}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      {/* 상단 다이아몬드 입력 포트 → Phase 슬롯 연결 */}
      <polygon points={`${cx},-4 ${cx + 4},0 ${cx},4 ${cx - 4},0`} fill={color} />
    </g>
  );
}

/** Trigger 노드: 둥근 사각형, 좌측 입력 없음, 우측 출력 포트. */
const TRIGGER_COLORS: Record<string, string> = {
  cron: "#e67e22", webhook: "#3498db", manual: "#2ecc71", channel_message: "#f1c40f",
};
const TRIGGER_ICONS: Record<string, string> = {
  cron: "⏰", webhook: "↗", manual: "▶", channel_message: "💬",
};
function TriggerNode({ node, pos, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const triggerType = node.sub_label || "manual";
  const color = TRIGGER_COLORS[triggerType] || "#e67e22";
  const icon = TRIGGER_ICONS[triggerType] || "▶";
  const outFields = node.output_fields || [];
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <rect width={pos.width} height={pos.height} rx={outFields.length > 0 ? 16 : pos.height / 2} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1} />
      {/* 아이콘 원 (좌측, 트리거 컬러) */}
      <circle cx={22} cy={18} r={14} fill={color} opacity={0.15} />
      <circle cx={22} cy={18} r={14} fill="none" stroke={color} strokeWidth={1.2} opacity={0.4} />
      <text x={22} y={22} textAnchor="middle" fontSize={12}>{icon}</text>
      {/* 제목 */}
      <text x={42} y={16} fill="var(--text, #cdd6f4)" fontSize={11} fontWeight={600}>
        {node.label.length > 12 ? node.label.slice(0, 12) + "…" : node.label}
      </text>
      {/* 부제 (schedule/path 등) */}
      {node.trigger_detail && (
        <text x={42} y={28} fill="var(--muted, #6c7086)" fontSize={8} fontFamily="monospace">
          {node.trigger_detail.length > 18 ? node.trigger_detail.slice(0, 18) + "…" : node.trigger_detail}
        </text>
      )}
      {/* 포트 영역 구분선 */}
      {outFields.length > 0 && (
        <line x1={10} y1={FIELD_PORT_TOP - 4} x2={pos.width - 10} y2={FIELD_PORT_TOP - 4} stroke="var(--line, #555)" strokeWidth={0.5} opacity={0.4} />
      )}
      {/* 출력 포트들 (우측) */}
      <OutputPorts fields={outFields} nodeWidth={pos.width} nodeId={node.id} onFieldDragStart={onFieldDragStart} />
    </g>
  );
}

/** Channel 노드: 양방향 — 입력 포트(좌) + 출력 포트(우). */
function ChannelNode({ node, pos, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const w = pos.width, h = pos.height;
  const inFields = node.input_fields || [];
  const outFields = node.output_fields || [];
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <rect width={w} height={h} rx={(inFields.length > 0 || outFields.length > 0) ? 16 : h / 2} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1} />
      {/* 아이콘 원 (좌측, 채널 컬러) */}
      <circle cx={22} cy={18} r={14} fill="var(--yellow, #f1c40f)" opacity={0.15} />
      <circle cx={22} cy={18} r={14} fill="none" stroke="var(--yellow, #f1c40f)" strokeWidth={1.2} opacity={0.4} />
      <text x={22} y={22} textAnchor="middle" fontSize={12}>💬</text>
      {/* 제목 */}
      <text x={42} y={16} fill="var(--text, #cdd6f4)" fontSize={11} fontWeight={600}>
        {node.label.length > 12 ? node.label.slice(0, 12) + "…" : node.label}
      </text>
      {node.sub_label && (
        <text x={42} y={28} fill="var(--muted, #6c7086)" fontSize={9}>{node.sub_label}</text>
      )}
      {/* 포트 영역 구분선 */}
      {(inFields.length > 0 || outFields.length > 0) && (
        <line x1={10} y1={FIELD_PORT_TOP - 4} x2={w - 10} y2={FIELD_PORT_TOP - 4} stroke="var(--line, #555)" strokeWidth={0.5} opacity={0.4} />
      )}
      {/* 입력 포트들 (좌측) */}
      <InputPorts fields={inFields} />
      {/* 출력 포트들 (우측) */}
      <OutputPorts fields={outFields} nodeWidth={w} nodeId={node.id} onFieldDragStart={onFieldDragStart} />
    </g>
  );
}

/** Split 노드: 다이아몬드 (teal). */
function SplitDiamondNode({ node, pos, onRun, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onRun?: (id: string, mode: "run" | "test") => void;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const w = pos.width, h = pos.height;
  const color = orche_color("split");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  const inFields = node.input_fields || [];
  const outFields = node.output_fields || [];
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel, #1e1e2e)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 - 6} textAnchor="middle" fill={color} fontSize={16} fontWeight={700}>↕</text>
      <text x={w / 2} y={h / 2 + 12} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      {/* 입력 포트 (좌측) */}
      {inFields.length > 0 ? inFields.map((field, i) => (
        <rect key={`in-${field.name}`} x={-5} y={h / 2 - 5 + i * FIELD_PORT_H} width={10} height={10} rx={2}
          fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5} className="graph-port graph-port--in"
        />
      )) : (
        <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5} className="graph-port graph-port--in" />
      )}
      {/* 출력 포트들 (우측) */}
      {outFields.map((field, i) => {
        const fy = h * 0.3 + i * 14;
        const fc = FIELD_TYPE_COLORS[field.type] || "#95a5a6";
        return (
          <g key={`out-${field.name}`}>
            <circle cx={w} cy={fy} r={14} fill="transparent"
              className="graph-port graph-port--field" data-port-name={field.name}
              style={{ cursor: "crosshair" }}
              onMouseDown={(e) => { e.stopPropagation(); onFieldDragStart?.(node.id, field.name, e); }}
            />
            <circle cx={w} cy={fy} r={FIELD_PORT_R} fill={fc} stroke={fc} strokeWidth={1} pointerEvents="none">
              <title>{field.name}: {field.type}</title>
            </circle>
          </g>
        );
      })}
      {onRun && (
        <g transform={`translate(${w / 2 + 20}, 12)`}
          onClick={(e) => { e.stopPropagation(); onRun(node.id, e.shiftKey ? "test" : "run"); }}
          style={{ cursor: "pointer" }} className="graph-play-btn"
        >
          <circle r={7} fill={color} opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={8} fill={color} style={{ pointerEvents: "none" }}>▶</text>
        </g>
      )}
    </g>
  );
}

/** Switch 노드: 다이아몬드 (amber) + N개 case 출력 포트. */
function SwitchDiamondNode({ node, pos, onRun, onFieldDragStart }: {
  node: GraphNode; pos: NodePos;
  onRun?: (id: string, mode: "run" | "test") => void;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const w = pos.width, h = pos.height;
  const color = orche_color("switch");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  const cases = ((node.orche_data as Record<string, unknown> | undefined)?.cases as Array<{ value: string }>) || [];
  const outPorts = cases.length > 0
    ? cases.map((c) => c.value)
    : ["default"];
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel, #1e1e2e)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 - 6} textAnchor="middle" fill={color} fontSize={14} fontWeight={700}>⑆</text>
      <text x={w / 2} y={h / 2 + 12} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      {/* 입력 포트 (좌측) */}
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={2}
        fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5} className="graph-port graph-port--in" />
      {/* Case 출력 포트들 (우측) */}
      {outPorts.map((label, i) => {
        const fy = h * 0.25 + i * (h * 0.5 / Math.max(1, outPorts.length - 1 || 1));
        return (
          <g key={`case-${i}`}>
            <circle cx={w} cy={fy} r={14} fill="transparent"
              className="graph-port graph-port--field" data-port-name={label}
              style={{ cursor: "crosshair" }}
              onMouseDown={(e) => { e.stopPropagation(); onFieldDragStart?.(node.id, label, e); }}
            />
            <circle cx={w} cy={fy} r={FIELD_PORT_R} fill={color} stroke={color} strokeWidth={1} pointerEvents="none">
              <title>case: {label}</title>
            </circle>
            <text x={w + 10} y={fy + 3} fill={color} fontSize={8}>{label.length > 8 ? label.slice(0, 8) + "…" : label}</text>
          </g>
        );
      })}
      {onRun && (
        <g transform={`translate(${w / 2 + 20}, 12)`}
          onClick={(e) => { e.stopPropagation(); onRun(node.id, e.shiftKey ? "test" : "run"); }}
          style={{ cursor: "pointer" }} className="graph-play-btn"
        >
          <circle r={7} fill={color} opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={8} fill={color} style={{ pointerEvents: "none" }}>▶</text>
        </g>
      )}
    </g>
  );
}

// ── Orchestration Node Components (registry 기반) ──

/** Registry에서 색상 조회 (fallback: #888). */
function orche_color(node_type: string): string {
  return get_frontend_node(node_type)?.color || "#888";
}

/** Registry에서 아이콘 조회. */
function orche_icon(node_type: string): string {
  return get_frontend_node(node_type)?.icon || "";
}

/** 노드 타입별 부제: 핵심 설정값 한줄 요약. */
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

/** 오케 노드 상태 배지 아이콘. */
const STATUS_BADGE: Record<string, { icon: string; color: string }> = {
  running: { icon: "⟳", color: "#3498db" },
  completed: { icon: "✓", color: "#2ecc71" },
  failed: { icon: "✗", color: "#e74c3c" },
  skipped: { icon: "⊘", color: "#6c7086" },
};

/** HTTP/Code/Set 등 캡슐(pill) 오케 노드. */
function OrcheRectNode({ node, pos, nodeStatus, onRun, onFieldDragStart }: {
  node: GraphNode;
  pos: NodePos;
  nodeStatus?: string;
  onRun?: (id: string, mode: "run" | "test") => void;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
}) {
  const color = orche_color(node.type) || "#888";
  const icon = orche_icon(node.type);
  const outFields = node.output_fields || [];
  const inFields = node.input_fields || [];
  const subtitle = get_node_subtitle(node);
  const badge = nodeStatus ? STATUS_BADGE[nodeStatus] : undefined;
  const has_ports = inFields.length > 0 || outFields.length > 0;
  const pill_rx = has_ports ? 16 : pos.height / 2;

  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      {/* 캡슐 배경 */}
      <rect width={pos.width} height={pos.height} rx={pill_rx} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1} />
      {/* 아이콘 원 (좌측, 노드 컬러 — 컬러바 대체) */}
      <circle cx={24} cy={20} r={15} fill={color} opacity={0.15} />
      <circle cx={24} cy={20} r={15} fill="none" stroke={color} strokeWidth={1.2} opacity={0.4} />
      <text x={24} y={24} textAnchor="middle" fontSize={13}>{icon}</text>
      {/* 제목 */}
      <text x={46} y={16} fill="var(--text, #cdd6f4)" fontSize={12} fontWeight={600}>
        {node.label.length > 14 ? node.label.slice(0, 14) + "…" : node.label}
      </text>
      {/* 부제 */}
      {subtitle && (
        <text x={46} y={28} fill="var(--muted, #6c7086)" fontSize={9}>
          {subtitle.length > 20 ? subtitle.slice(0, 20) + "…" : subtitle}
        </text>
      )}
      {/* 상태 배지 */}
      {badge && (
        <g transform={`translate(${pos.width - 18}, 8)`}>
          <circle r={8} fill={badge.color} opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={10} fill={badge.color} style={{ pointerEvents: "none" }}>{badge.icon}</text>
        </g>
      )}
      {/* ▶ Play 버튼 */}
      {onRun && !badge && (
        <g
          transform={`translate(${pos.width - 18}, 20)`}
          onClick={(e) => { e.stopPropagation(); onRun(node.id, e.shiftKey ? "test" : "run"); }}
          style={{ cursor: "pointer" }}
          className="graph-play-btn"
        >
          <circle r={9} fill={color} opacity={0.15} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={9} fill={color} style={{ pointerEvents: "none" }}>▶</text>
        </g>
      )}
      {/* 포트 영역 구분선 */}
      {has_ports && (
        <line x1={10} y1={FIELD_PORT_TOP - 4} x2={pos.width - 10} y2={FIELD_PORT_TOP - 4} stroke="var(--line, #555)" strokeWidth={0.5} opacity={0.4} />
      )}
      {/* 입력 포트들 (좌측) */}
      {inFields.length > 0 ? (
        <InputPorts fields={inFields} />
      ) : (
        <rect x={-5} y={pos.height / 2 - 5} width={10} height={10} rx={5} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5} className="graph-port graph-port--in" />
      )}
      {/* 출력 포트들 (우측) */}
      {outFields.length > 0 ? (
        <OutputPorts fields={outFields} nodeWidth={pos.width} nodeId={node.id} onFieldDragStart={onFieldDragStart} />
      ) : (
        <circle cx={pos.width} cy={pos.height / 2} r={PORT_R} fill={color} stroke={color} strokeWidth={1.5} className="graph-port graph-port--out" />
      )}
    </g>
  );
}

/** 노드 오른쪽 `+` 핸들 — hover 시 표시. */
function AddHandle({ pos, onClick, onDragStart }: {
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
      <circle r={12} fill="var(--panel, #1e1e2e)" stroke="var(--accent, #89b4fa)" strokeWidth={1.5} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={16} fill="var(--accent, #89b4fa)" pointerEvents="none">+</text>
    </g>
  );
}

/** 그룹 프레임: 노드 그루핑 시각화. */
function GroupFrame({ group, positions, onUpdate, onDelete, onToggleCollapse }: {
  group: NodeGroup;
  positions: Map<string, NodePos>;
  onUpdate: (patch: Partial<NodeGroup>) => void;
  onDelete: () => void;
  onToggleCollapse: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // 그룹 내 노드들의 bounding box
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

  return (
    <g className="graph-group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <rect
        x={minX - pad} y={minY - pad - headerH}
        width={maxX - minX + pad * 2} height={maxY - minY + pad * 2 + headerH}
        rx={12}
        fill={group.color} fillOpacity={0.08}
        stroke={group.color} strokeOpacity={0.3} strokeWidth={1.5}
      />
      <text
        x={minX - pad + 12} y={minY - pad - 8}
        fill={group.color} fontSize={13} fontWeight={600}
      >
        {group.label}
      </text>
      {hovered && (
        <foreignObject
          x={maxX - 80} y={minY - pad - headerH + 2}
          width={100} height={24}
        >
          <div className="graph-group__toolbar" style={{ display: "flex", gap: 2 }}>
            <button onClick={onToggleCollapse} title={group.collapsed ? "Expand" : "Collapse"}>
              {group.collapsed ? "\u25B8" : "\u25BE"}
            </button>
            <button onClick={() => {
              const name = prompt("Group name", group.label);
              if (name) onUpdate({ label: name });
            }}>
              \u270E
            </button>
            <button onClick={onDelete} className="graph-ctx__item--danger">\u2715</button>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

/** IF 노드: 다이아몬드 + TRUE/FALSE 출력 포트. */
function IfDiamondNode({ node, pos, onRun }: { node: GraphNode; pos: NodePos; onRun?: (id: string, mode: "run" | "test") => void }) {
  const w = pos.width, h = pos.height;
  const color = orche_color("if");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel, #1e1e2e)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 - 6} textAnchor="middle" fill={color} fontSize={16} fontWeight={700}>?</text>
      <text x={w / 2} y={h / 2 + 12} textAnchor="middle" fill="var(--text, #cdd6f4)" fontSize={10}>
        {node.label.length > 10 ? node.label.slice(0, 10) + "…" : node.label}
      </text>
      {/* TRUE 출력 (우측) */}
      <circle cx={w} cy={h * 0.35} r={PORT_R} fill="#2ecc71" stroke="#2ecc71" strokeWidth={1.5} className="graph-port graph-port--field" />
      <text x={w + 12} y={h * 0.35 + 3} fill="#2ecc71" fontSize={8} fontWeight={600}>TRUE</text>
      {/* FALSE 출력 (우측 하단) */}
      <circle cx={w} cy={h * 0.65} r={PORT_R} fill="var(--err, #e74c3c)" stroke="var(--err, #e74c3c)" strokeWidth={1.5} className="graph-port graph-port--field" />
      <text x={w + 12} y={h * 0.65 + 3} fill="var(--err, #e74c3c)" fontSize={8} fontWeight={600}>FALSE</text>
      {/* ▶ Play 버튼 */}
      {onRun && (
        <g
          transform={`translate(${w / 2 + 20}, 12)`}
          onClick={(e) => { e.stopPropagation(); onRun(node.id, e.shiftKey ? "test" : "run"); }}
          style={{ cursor: "pointer" }}
          className="graph-play-btn"
        >
          <circle r={9} fill={color} opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={10} fill={color} style={{ pointerEvents: "none" }}>▶</text>
        </g>
      )}
      {/* 입력 포트 (사각형) */}
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5} className="graph-port graph-port--in" />
    </g>
  );
}

/** Merge 노드: 소형 다이아몬드. */
function MergeDiamondNode({ node, pos, onRun }: { node: GraphNode; pos: NodePos; onRun?: (id: string, mode: "run" | "test") => void }) {
  const w = pos.width, h = pos.height;
  const color = orche_color("merge");
  const points = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
  return (
    <g transform={`translate(${pos.x}, ${pos.y})`}>
      <polygon points={points} fill="var(--panel, #1e1e2e)" stroke={color} strokeWidth={1.5} />
      <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fill={color} fontSize={16} fontWeight={700}>⊕</text>
      {onRun && (
        <g
          transform={`translate(${w / 2 + 16}, 4)`}
          onClick={(e) => { e.stopPropagation(); onRun(node.id, e.shiftKey ? "test" : "run"); }}
          style={{ cursor: "pointer" }}
          className="graph-play-btn"
        >
          <circle r={7} fill={color} opacity={0.2} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={8} fill={color} style={{ pointerEvents: "none" }}>▶</text>
        </g>
      )}
      {/* 입력 포트 (사각형) */}
      <rect x={-5} y={h / 2 - 5} width={10} height={10} rx={5} fill="var(--panel, #1e1e2e)" stroke="var(--line, #555)" strokeWidth={1.5} className="graph-port graph-port--in" />
      <circle cx={w} cy={h / 2} r={PORT_R} fill={color} stroke={color} strokeWidth={1.5} className="graph-port graph-port--out" />
    </g>
  );
}

/** 오케 노드인지 판별 — registry 조회. */
function is_orche_type(t: string): boolean {
  return !!get_frontend_node(t);
}

/** 노드 타입에 따라 적절한 SVG 컴포넌트 렌더링. 오케 노드는 드래그 가능. */
function AuxNode({ node, pos, isRunning, isSelected, nodeStatus, onRunNode, onDragStart, onTouchStart, onDoubleClick, onFieldDragStart, onClick }: {
  node: GraphNode;
  pos: NodePos;
  isRunning?: boolean;
  isSelected?: boolean;
  /** 오케 노드 실행 상태 (pending/running/completed/failed/skipped). */
  nodeStatus?: string;
  onRunNode?: (id: string, mode: "run" | "test") => void;
  onDragStart?: (id: string, e: React.MouseEvent) => void;
  onTouchStart?: (id: string, touch: { clientX: number; clientY: number }) => void;
  onDoubleClick?: (id: string) => void;
  onFieldDragStart?: (nodeId: string, fieldName: string, e: React.MouseEvent) => void;
  onClick?: (id: string) => void;
}) {
  const is_orche = is_orche_type(node.type);

  const inner = (() => {
    // 비-오케 노드: 전용 컴포넌트
    switch (node.type) {
      case "sub_node": return <ClusterSubNode node={node} pos={pos} onDoubleClick={() => onDoubleClick?.(node.id)} />;
      case "trigger": return <TriggerNode node={node} pos={pos} onFieldDragStart={onFieldDragStart} />;
      case "channel": return <ChannelNode node={node} pos={pos} onFieldDragStart={onFieldDragStart} />;
    }
    // 오케 노드: shape 기반 디스패치
    const desc = get_frontend_node(node.type);
    if (!desc) return null;
    if (desc.shape === "rect") {
      return <OrcheRectNode node={node} pos={pos} nodeStatus={nodeStatus || (isRunning ? "running" : undefined)} onRun={onRunNode} onFieldDragStart={onFieldDragStart} />;
    }
    // diamond 노드: 포트 레이아웃이 각각 다르므로 전용 컴포넌트
    switch (node.type) {
      case "if": return <IfDiamondNode node={node} pos={pos} onRun={onRunNode} />;
      case "merge": return <MergeDiamondNode node={node} pos={pos} onRun={onRunNode} />;
      case "split": return <SplitDiamondNode node={node} pos={pos} onRun={onRunNode} onFieldDragStart={onFieldDragStart} />;
      case "switch": return <SwitchDiamondNode node={node} pos={pos} onRun={onRunNode} onFieldDragStart={onFieldDragStart} />;
      default: return null;
    }
  })();

  /* 모든 보조 노드: 드래그 + 더블클릭 래퍼 */
  return (
    <g
      data-node-id={node.id}
      className="graph-node"
      style={{ cursor: "grab" }}
      onClick={() => onClick?.(node.id)}
      onMouseDown={(e) => { if (!(e.target as Element).closest(".graph-port, .graph-play-btn")) onDragStart?.(node.id, e); }}
      onTouchStart={(e) => { if (e.touches.length === 1 && !(e.target as Element).closest(".graph-port, .graph-play-btn")) onTouchStart?.(node.id, e.touches[0]!); }}
      onDoubleClick={() => onDoubleClick?.(node.id)}
    >
      {/* 선택 하이라이트 */}
      {isSelected && (
        <rect
          x={pos.x - 3} y={pos.y - 3}
          width={pos.width + 6} height={pos.height + 6}
          rx={12}
          fill="none"
          stroke="var(--accent, #89b4fa)"
          strokeWidth={1.5}
          strokeDasharray="6 3"
          opacity={0.5}
        />
      )}
      {isRunning && is_orche && (
        <rect
          x={pos.x - 4} y={pos.y - 4}
          width={pos.width + 8} height={pos.height + 8}
          rx={14}
          fill="none"
          stroke={orche_color(node.type) || "var(--accent, #89b4fa)"}
          strokeWidth={2}
          opacity={0.6}
          className="node-running-glow"
        />
      )}
      {inner}
    </g>
  );
}

// ── Main Graph Editor Component ──

type DragState = {
  from_id: string;
  from_port: string;   // output 포트 이름 ("result", "payload", "error" 등)
  mouse: { x: number; y: number };
} | null;

// ── Zoom/Pan 상수 ──

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_FACTOR = 1.12;   // 배율 방식 줌 (12% 씩)

export function GraphEditor({
  workflow,
  onChange,
  selectedPhaseId,
  onSelectPhase,
  onEditPhase,
  onRunNode,
  onEditSubNode,
  runningNodeId,
  orcheStates,
}: {
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  selectedPhaseId: string | null;
  onSelectPhase: (id: string | null) => void;
  onEditPhase?: (id: string) => void;
  /** 노드 단독 실행 콜백 (▶ 클릭 = "run", Shift+▶ = "test"). */
  onRunNode?: (id: string, mode: "run" | "test") => void;
  /** 클러스터 Sub-node 더블클릭 콜백 (phaseId__agentId 형식). */
  onEditSubNode?: (subNodeId: string) => void;
  /** 현재 실행 중인 노드 ID (펄스 이펙트 표시). */
  runningNodeId?: string | null;
  /** 오케 노드 실행 상태 (PhaseLoopState.orche_states). */
  orcheStates?: Array<{ node_id: string; status: string }>;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // NodePicker 상태
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<
    | { type: "handle"; source_id: string }
    | { type: "edge"; from_id: string; to_id: string }
    | null
  >(null);
  /** 드래그 드롭으로 노드 배치 시 SVG 좌표. */
  const [pickerDropPos, setPickerDropPos] = useState<{ x: number; y: number } | null>(null);

  // AddHandle 드래그 상태: +핸들에서 드래그 → 연결선 → 드롭 시 picker
  const [handleDrag, setHandleDrag] = useState<{
    source_id: string;
    origin: { x: number; y: number };
    mouse: { x: number; y: number };
  } | null>(null);
  const handleDragRef = useRef(handleDrag);
  handleDragRef.current = handleDrag;
  /** 드롭으로 생성된 노드의 위치 보정 예약. */
  const pendingDropRef = useRef<{ node_id: string; pos: { x: number; y: number } } | null>(null);

  // 다중 선택 (marquee + 모바일 롱프레스)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectRect, setSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const selectDrag = useRef<{ startX: number; startY: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** zoom=1 → 100%, contentBox = 노드 범위 기준 viewBox. */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  /** 노드 수동 위치 오프셋 (자동 레이아웃 대비 delta). */
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const nodeDrag = useRef<{ id: string; startSvg: { x: number; y: number }; startOffset: { dx: number; dy: number }; moved: boolean } | null>(null);
  const DRAG_THRESHOLD = 5;

  const autoPositions = compute_positions(workflow.phases);
  /** 보조 노드 + 위치 계산. */
  const auxData = compute_aux_positions(workflow, autoPositions);
  /** 자동 레이아웃 + 수동 오프셋 합산 (Phase + 보조 노드 모두 포함). */
  const positions = (() => {
    const merged = new Map<string, NodePos>();
    for (const [id, pos] of autoPositions) {
      const off = nodeOffsets[id];
      merged.set(id, off ? { ...pos, x: pos.x + off.dx, y: pos.y + off.dy } : pos);
    }
    for (const [id, pos] of auxData.positions) {
      const off = nodeOffsets[id];
      merged.set(id, off ? { ...pos, x: pos.x + off.dx, y: pos.y + off.dy } : pos);
    }
    return merged;
  })();
  const edges = [
    ...compute_edges(workflow.phases),
    ...compute_aux_edges(workflow),
  ];

  // 드롭으로 생성된 노드의 위치를 드롭 좌표로 보정
  if (pendingDropRef.current) {
    const { node_id, pos: dropPos } = pendingDropRef.current;
    const layoutPos = positions.get(node_id);
    if (layoutPos) {
      const dx = dropPos.x - layoutPos.x + (nodeOffsets[node_id]?.dx || 0);
      const dy = dropPos.y - layoutPos.y + (nodeOffsets[node_id]?.dy || 0);
      pendingDropRef.current = null;
      // 다음 틱에서 offset 적용 (현재 렌더 중 setState 방지)
      queueMicrotask(() => setNodeOffsets((prev) => ({ ...prev, [node_id]: { dx, dy } })));
    }
  }

  /** SVG 엘리먼트 실제 크기 추적 (viewBox를 콘텐츠가 아닌 뷰포트 기준으로). */
  const [svgSize, setSvgSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSvgSize({ w: entry.contentRect.width || 800, h: entry.contentRect.height || 600 });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  /** 노드 전체 범위 (fit-to-content 리셋용). */
  const contentBox = (() => {
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const pos of positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 400, h: 300 };
    const OVERLAY_BOTTOM = 60; // 좌하단 줌 오버레이 여유 공간
    return {
      x: minX - PADDING,
      y: minY - PADDING,
      w: maxX - minX + PADDING * 2,
      h: maxY - minY + PADDING + OVERLAY_BOTTOM,
    };
  })();

  /** zoom + pan 적용된 viewBox — SVG 엘리먼트 크기 기준 (콘텐츠 무관). */
  const viewBox = {
    x: pan.x,
    y: pan.y,
    w: svgSize.w / zoom,
    h: svgSize.h / zoom,
  };

  /** SVG 좌표 변환 (useEffect 내에서도 안전하게 사용 가능). */
  const svgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    if (!ctm) return { x: clientX, y: clientY };
    const svgPt = pt.matrixTransform(ctm);
    return { x: svgPt.x, y: svgPt.y };
  };
  const svgPointRef = useRef(svgPoint);
  svgPointRef.current = svgPoint;

  /** 노드 드래그 시작. */
  const handleNodeDragStart = (phase_id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const pt = svgPoint(e.clientX, e.clientY);
    const off = nodeOffsets[phase_id] || { dx: 0, dy: 0 };
    nodeDrag.current = { id: phase_id, startSvg: pt, startOffset: off, moved: false };
  };

  /** 노드 터치 드래그 시작 + 롱프레스 다중 선택. */
  const handleNodeTouchStart = (phase_id: string, touch: { clientX: number; clientY: number }) => {
    if (multiSelectMode) {
      // 다중 선택 모드에서 탭 → 토글
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(phase_id)) next.delete(phase_id); else next.add(phase_id);
        return next;
      });
      return;
    }
    const pt = svgPoint(touch.clientX, touch.clientY);
    const off = nodeOffsets[phase_id] || { dx: 0, dy: 0 };
    nodeDrag.current = { id: phase_id, startSvg: pt, startOffset: off, moved: false };
    // 롱프레스 → 다중 선택 모드 진입
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      nodeDrag.current = null; // 드래그 취소
      setMultiSelectMode(true);
      setMultiSelected(new Set([phase_id]));
    }, 500);
  };

  const portDragStartRef = useRef<(nodeId: string, portName: string) => void>(undefined);
  /** 출력 포트 드래그 시작 (통합: Phase/오케/트리거 모두 동일 인터페이스). */
  const handlePortDragStart = (nodeId: string, portName: string) => {
    const pos = positions.get(nodeId);
    if (!pos) return;
    // 포트 위치 계산: 노드의 출력 필드에서 인덱스 탐색
    const phase = workflow.phases.find((p) => p.phase_id === nodeId);
    const auxNode = auxData.nodes.find((n) => n.id === nodeId);
    const outFields = phase
      ? (PHASE_OUTPUT)
      : (auxNode?.output_fields || []);
    const idx = outFields.findIndex((f) => f.name === portName);
    const fy = idx >= 0
      ? FIELD_PORT_TOP + idx * FIELD_PORT_H
      : pos.height / 2;
    setDrag({ from_id: nodeId, from_port: portName, mouse: { x: pos.x + pos.width, y: pos.y + fy } });
  };
  portDragStartRef.current = handlePortDragStart;

  /** 휠 이벤트 — Ctrl/Meta+Wheel: 줌, 일반 Wheel: 팬 (트랙패드 친화). */
  const wheelHandler = useRef<(e: WheelEvent) => void>(undefined);
  wheelHandler.current = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Wheel 또는 트랙패드 핀치 → 줌 (피벗 기반)
      const pivot = svgPoint(e.clientX, e.clientY);
      setZoom((prev) => {
        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
        const scale = next / prev;
        setPan((p) => ({
          x: pivot.x - (pivot.x - p.x) / scale,
          y: pivot.y - (pivot.y - p.y) / scale,
        }));
        return next;
      });
    } else {
      // 일반 Wheel / 트랙패드 두 손가락 스크롤 → 팬
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = (svgSize.w / zoom) / rect.width;
      const scaleY = (svgSize.h / zoom) / rect.height;
      setPan((p) => ({
        x: p.x + e.deltaX * scaleX,
        y: p.y + e.deltaY * scaleY,
      }));
    }
  };
  /** ref 래핑 — 터치 핸들러에서 stale closure 방지. */
  const mouseUpRef = useRef<() => void>(undefined);

  /** 터치 상태 (핀치 줌 + 원터치 팬). */
  const touchState = useRef<{ lastDist: number; lastCenter: { x: number; y: number }; fingers: number; portDrag: boolean }>({
    lastDist: 0, lastCenter: { x: 0, y: 0 }, fingers: 0, portDrag: false,
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
          fingers: 2, portDrag: false,
        };
      } else if (e.touches.length === 1) {
        // 포트 터치 → 포트 드래그 시작
        const portEl = (e.target as Element).closest(".graph-port--field, .graph-port--out");
        if (portEl) {
          e.preventDefault();
          const nodeEl = portEl.closest("[data-node-id]") as Element | null;
          const nodeId = nodeEl?.getAttribute("data-node-id");
          const portName = portEl.getAttribute("data-port-name");
          if (nodeId && portName) {
            touchState.current = { lastDist: 0, lastCenter: { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }, fingers: 1, portDrag: true };
            portDragStartRef.current?.(nodeId, portName);
            return;
          }
        }
        touchState.current = {
          lastDist: 0,
          lastCenter: { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY },
          fingers: 1, portDrag: false,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // 롱프레스 타이머 취소 (이동 시작하면 롱프레스 아님)
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      // AddHandle 터치 드래그
      if (handleDragRef.current && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0]!;
        const sp = svgPointRef.current(touch.clientX, touch.clientY);
        setHandleDrag((prev) => prev ? { ...prev, mouse: sp } : null);
        return;
      }
      // 포트 터치 드래그 (엣지 연결)
      if (touchState.current.portDrag && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0]!;
        const sp = svgPointRef.current(touch.clientX, touch.clientY);
        setDrag((prev) => prev ? { ...prev, mouse: sp } : prev);
        return;
      }
      // 노드 터치 드래그
      const nd = nodeDrag.current;
      if (nd && e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0]!;
        const pt = svgPointRef.current(touch.clientX, touch.clientY);
        const dx = pt.x - nd.startSvg.x;
        const dy = pt.y - nd.startSvg.y;
        if (!nd.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        nd.moved = true;
        setNodeOffsets((prev) => ({
          ...prev,
          [nd.id]: { dx: nd.startOffset.dx + dx, dy: nd.startOffset.dy + dy },
        }));
        return;
      }

      const ts = touchState.current;
      if (e.touches.length === 2 && ts.fingers === 2) {
        e.preventDefault();
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const ratio = dist / (ts.lastDist || 1);
        // 핀치 중심을 피벗으로 줌 + 팬 보정
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        const pivotSvg = svgPointRef.current(cx, cy);
        setZoom((prev) => {
          const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * ratio));
          const scale = next / prev;
          setPan((p) => ({
            x: pivotSvg.x - (pivotSvg.x - p.x) / scale,
            y: pivotSvg.y - (pivotSvg.y - p.y) / scale,
          }));
          return next;
        });
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

    const onTouchEnd = () => {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      // AddHandle 터치 드래그 완료
      const hd = handleDragRef.current;
      if (hd) {
        const dist = Math.hypot(hd.mouse.x - hd.origin.x, hd.mouse.y - hd.origin.y);
        if (dist > 10) {
          setPickerSource({ type: "handle", source_id: hd.source_id });
          setPickerDropPos(hd.mouse);
          setPickerOpen(true);
        }
        setHandleDrag(null);
        return;
      }
      if (touchState.current.portDrag) {
        touchState.current.portDrag = false;
        mouseUpRef.current?.();
      }
      touchState.current.fingers = 0;
      nodeDrag.current = null;
    };

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

  /** 캔버스 팬: 빈 영역 좌클릭 또는 중간 버튼 어디서든 드래그. */
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 중간 버튼(wheel click) → 어디서든 팬 시작
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    if (drag) return; // 포트 드래그 중이면 무시
    const isOnNode = (e.target as Element).closest(".graph-port, .graph-node, .graph-play-btn, .graph-add-handle, .graph-edge-add");
    if (isOnNode) return;
    // Shift+드래그 → marquee 선택
    if (e.shiftKey) {
      const pt = svgPoint(e.clientX, e.clientY);
      selectDrag.current = { startX: pt.x, startY: pt.y };
      setMultiSelected(new Set());
      return;
    }
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  /** 드래그 중 마우스 이동 (노드 드래그 + 캔버스 팬 + 포트 드래그 + marquee + AddHandle 드래그). */
  const handleMouseMove = (e: React.MouseEvent) => {
    // AddHandle 드래그
    if (handleDrag) {
      const pt = svgPoint(e.clientX, e.clientY);
      setHandleDrag((prev) => prev ? { ...prev, mouse: pt } : null);
      return;
    }
    // Marquee 선택 드래그
    if (selectDrag.current) {
      const pt = svgPoint(e.clientX, e.clientY);
      const { startX, startY } = selectDrag.current;
      setSelectRect({
        x: Math.min(startX, pt.x), y: Math.min(startY, pt.y),
        w: Math.abs(pt.x - startX), h: Math.abs(pt.y - startY),
      });
      return;
    }
    // 노드 드래그
    const nd = nodeDrag.current;
    if (nd) {
      const pt = svgPoint(e.clientX, e.clientY);
      const dx = pt.x - nd.startSvg.x;
      const dy = pt.y - nd.startSvg.y;
      if (!nd.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      nd.moved = true;
      setNodeOffsets((prev) => ({
        ...prev,
        [nd.id]: { dx: nd.startOffset.dx + dx, dy: nd.startOffset.dy + dy },
      }));
      return;
    }
    // 캔버스 팬
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
    // 포트 드래그
    if (!drag) return;
    const pt = svgPoint(e.clientX, e.clientY);
    setDrag({ ...drag, mouse: pt });
  };

  /** 드롭: 노드 드래그 종료 + 대상 노드 위에서 마우스 업 + 팬 종료 + marquee 완료 + AddHandle 드롭. */
  const handleMouseUp = () => {
    // AddHandle 드래그 완료 → 드롭 위치에 NodePicker 열기
    if (handleDrag) {
      const dropSvg = handleDrag.mouse;
      const dist = Math.hypot(dropSvg.x - handleDrag.origin.x, dropSvg.y - handleDrag.origin.y);
      if (dist > 10) {
        setPickerSource({ type: "handle", source_id: handleDrag.source_id });
        setPickerDropPos(dropSvg);
        setPickerOpen(true);
      }
      setHandleDrag(null);
      return;
    }
    // Marquee 선택 완료
    if (selectDrag.current) {
      if (selectRect) {
        const selected = new Set<string>();
        for (const [id, pos] of positions) {
          // 사각형 겹침 판정
          if (pos.x + pos.width > selectRect.x && pos.x < selectRect.x + selectRect.w &&
              pos.y + pos.height > selectRect.y && pos.y < selectRect.y + selectRect.h) {
            selected.add(id);
          }
        }
        setMultiSelected(selected);
      }
      setSelectRect(null);
      selectDrag.current = null;
      return;
    }
    if (nodeDrag.current) {
      const wasDrag = nodeDrag.current.moved;
      nodeDrag.current = null;
      if (wasDrag) return; // 드래그였으면 클릭 이벤트 방지
    }
    if (isPanning) { setIsPanning(false); return; }
    if (!drag) return;

    // 모든 노드의 모든 입력 포트 위치를 계산하여 가장 가까운 포트 탐지
    let target_id: string | null = null;
    let target_port: string | null = null;
    let min_dist = 30;

    for (const [id, pos] of positions) {
      if (id === drag.from_id) continue;
      // 해당 노드의 입력 포트들 조회
      const phase = workflow.phases.find((p) => p.phase_id === id);
      const auxNode = auxData.nodes.find((n) => n.id === id);
      const inFields = phase
        ? (PHASE_INPUT)
        : (auxNode?.input_fields || []);

      if (inFields.length > 0) {
        for (let i = 0; i < inFields.length; i++) {
          const fy = FIELD_PORT_TOP + i * FIELD_PORT_H;
          const inX = pos.x;
          const inY = pos.y + fy;
          const dist = Math.hypot(drag.mouse.x - inX, drag.mouse.y - inY);
          if (dist < min_dist) {
            min_dist = dist;
            target_id = id;
            target_port = inFields[i]!.name;
          }
        }
      } else {
        // 입력 포트 없는 노드: 좌측 중앙
        const dist = Math.hypot(drag.mouse.x - pos.x, drag.mouse.y - (pos.y + pos.height / 2));
        if (dist < min_dist) {
          min_dist = dist;
          target_id = id;
          target_port = null;
        }
      }
    }

    if (target_id) {
      // field_mappings에 추가 + depends_on 자동 설정
      const mappings = [...(workflow.field_mappings || [])];
      mappings.push({
        from_node: drag.from_id,
        from_field: drag.from_port,
        to_node: target_id,
        to_field: target_port || "",
      });
      const updates: Partial<WorkflowDef> = { field_mappings: mappings };

      // 타겟이 오케 노드면 depends_on에 소스 추가
      const orche_nodes = (workflow.orche_nodes || []).map((n) => ({ ...n }));
      const target_orche = orche_nodes.find((n) => n.node_id === target_id);
      if (target_orche) {
        const deps = new Set((target_orche.depends_on as string[] | undefined) || []);
        deps.add(drag.from_id);
        target_orche.depends_on = [...deps];
        updates.orche_nodes = orche_nodes;
      }
      // 타겟이 Phase면 depends_on에 소스 추가
      const phases = workflow.phases.map((p) => ({ ...p }));
      const target_phase = phases.find((p) => p.phase_id === target_id);
      if (target_phase) {
        const deps = new Set(target_phase.depends_on || []);
        deps.add(drag.from_id);
        target_phase.depends_on = [...deps];
        updates.phases = phases;
      }
      onChange({ ...workflow, ...updates });
    }
    setDrag(null);
  };
  mouseUpRef.current = handleMouseUp;

  const addPhase = () => {
    const idx = workflow.phases.length;
    const newPhase: PhaseDef = {
      phase_id: `phase-${idx + 1}`,
      title: `Phase ${idx + 1}`,
      agents: [{ agent_id: `agent-1`, role: "", label: "", backend: "", system_prompt: "", max_turns: 3 }],
    };
    if (idx > 0) {
      newPhase.depends_on = [workflow.phases[idx - 1]!.phase_id];
    }
    onChange({ ...workflow, phases: [...workflow.phases, newPhase] });
  };

  /** NodePicker 열기: 노드 핸들에서. */
  const openPickerFromHandle = (source_id: string) => {
    setPickerSource({ type: "handle", source_id });
    setPickerOpen(true);
  };

  /** NodePicker 열기: 엣지 중간 삽입. */
  const openPickerForEdge = (from_id: string, to_id: string) => {
    setPickerSource({ type: "edge", from_id, to_id });
    setPickerOpen(true);
  };

  /** NodePicker 선택 핸들러: 노드 생성 + 자동 연결. */
  const handlePickerSelect = (node_type: string, preset?: NodePreset) => {
    // 특수 타입: Phase
    if (node_type === "__phase__") {
      addPhase();
      setPickerOpen(false);
      setPickerSource(null);
      return;
    }
    // 특수 타입: Trigger
    const triggerMatch = node_type.match(/^__trigger_(\w+)__$/);
    if (triggerMatch) {
      addTriggerNode(triggerMatch[1] as TriggerType);
      setPickerOpen(false);
      setPickerSource(null);
      return;
    }

    const desc = get_frontend_node(node_type);
    if (!desc) { setPickerOpen(false); return; }
    const existing = workflow.orche_nodes || [];
    const idx = existing.length + 1;
    const defaults = preset ? preset.defaults : desc.create_default();
    const label = preset ? preset.label : desc.toolbar_label.replace(/^\+\s*/, "");
    const node_id = `${node_type}-${idx}`;
    const newNode: OrcheNodeDef = {
      node_id,
      node_type: node_type as OrcheNodeDef["node_type"],
      title: `${label} ${idx}`,
      ...defaults,
    } as OrcheNodeDef;

    let updatedOrche = [...existing, newNode];
    let updatedPhases = workflow.phases;

    if (pickerSource?.type === "handle") {
      newNode.depends_on = [pickerSource.source_id];
    } else if (pickerSource?.type === "edge") {
      const { from_id, to_id } = pickerSource;
      newNode.depends_on = [from_id];
      updatedOrche = updatedOrche.map((n) => {
        if (n.node_id !== to_id) return n;
        const deps = ((n.depends_on as string[]) || []).map((d) => d === from_id ? node_id : d);
        return { ...n, depends_on: deps };
      });
      updatedPhases = workflow.phases.map((p) => {
        if (p.phase_id !== to_id) return p;
        const deps = (p.depends_on || []).map((d) => d === from_id ? node_id : d);
        return { ...p, depends_on: deps };
      });
    }

    // 드롭 위치에 노드 배치 예약
    if (pickerDropPos) {
      pendingDropRef.current = { node_id, pos: pickerDropPos };
    }

    onChange({ ...workflow, phases: updatedPhases, orche_nodes: updatedOrche });
    setPickerOpen(false);
    setPickerSource(null);
    setPickerDropPos(null);
  };

  /** 그룹 생성: 다중 선택된 노드로. */
  const createGroup = () => {
    if (multiSelected.size < 2) return;
    const groups = [...(workflow.groups || [])];
    const group_id = `group-${groups.length + 1}`;
    const COLORS = ["#3498db", "#e91e63", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];
    groups.push({
      group_id,
      label: `Group ${groups.length + 1}`,
      color: COLORS[groups.length % COLORS.length]!,
      node_ids: [...multiSelected],
    });
    onChange({ ...workflow, groups });
    setMultiSelected(new Set());
    setMultiSelectMode(false);
  };

  /** 그룹 업데이트. */
  const updateGroup = (group_id: string, patch: Partial<NodeGroup>) => {
    const groups = (workflow.groups || []).map((g) =>
      g.group_id === group_id ? { ...g, ...patch } : g
    );
    onChange({ ...workflow, groups });
  };

  /** 그룹 삭제 (노드 유지, 프레임만 제거). */
  const deleteGroup = (group_id: string) => {
    const groups = (workflow.groups || []).filter((g) => g.group_id !== group_id);
    onChange({ ...workflow, groups });
  };

  const addTriggerNode = (trigger_type: TriggerType) => {
    const existing = workflow.trigger_nodes || [];
    const idx = existing.length + 1;
    const node: TriggerNodeDef = { id: `trigger-${idx}`, trigger_type };
    if (trigger_type === "cron") node.schedule = "0 9 * * *";
    onChange({ ...workflow, trigger_nodes: [...existing, node] });
  };

  /** 드래그 시작점 좌표: 출력 포트 위치. */
  const dragStartPos = (() => {
    if (!drag) return null;
    const pos = positions.get(drag.from_id);
    if (!pos) return null;
    // 해당 노드의 출력 필드에서 포트 인덱스 탐색
    const phase = workflow.phases.find((p) => p.phase_id === drag.from_id);
    const auxNode = auxData.nodes.find((n) => n.id === drag.from_id);
    const outFields = phase
      ? (PHASE_OUTPUT)
      : (auxNode?.output_fields || []);
    const idx = outFields.findIndex((f) => f.name === drag.from_port);
    const fy = idx >= 0 ? FIELD_PORT_TOP + idx * FIELD_PORT_H : pos.height / 2;
    return { x: pos.x + pos.width, y: pos.y + fy };
  })();

  /** 피벗 기반 줌: 선택된 노드 중심 또는 뷰포트 중심. */
  const zoomTo = (dir: 1 | -1) => {
    setZoom((prev) => {
      const factor = dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
      if (next === prev) return prev;
      const selPos = selectedPhaseId ? positions.get(selectedPhaseId) : null;
      const pivot = selPos
        ? { x: selPos.x + selPos.width / 2, y: selPos.y + selPos.height / 2 }
        : { x: pan.x + svgSize.w / prev / 2, y: pan.y + svgSize.h / prev / 2 };
      const scale = next / prev;
      setPan((p) => ({
        x: pivot.x - (pivot.x - p.x) / scale,
        y: pivot.y - (pivot.y - p.y) / scale,
      }));
      return next;
    });
  };
  const zoomIn = () => zoomTo(1);
  const zoomOut = () => zoomTo(-1);
  /** Fit-to-content 리셋: 모든 노드가 보이도록 줌+팬 조정. */
  const zoomReset = () => {
    const zx = svgSize.w / contentBox.w;
    const zy = svgSize.h / contentBox.h;
    const fitZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zx, zy) * 0.9));
    setZoom(fitZoom);
    setPan({ x: contentBox.x, y: contentBox.y });
  };

  /** 엣지 삭제: flow → depends_on 제거, mapping → field_mappings 제거. */
  const deleteEdge = (edge: Edge) => {
    if (edge.type === "flow") {
      const phases = workflow.phases.map((p) => {
        if (p.phase_id !== edge.to) return p;
        return { ...p, depends_on: (p.depends_on || []).filter((d) => d !== edge.from) };
      });
      const orche = (workflow.orche_nodes || []).map((n) => {
        if (n.node_id !== edge.to) return n;
        return { ...n, depends_on: ((n.depends_on as string[]) || []).filter((d) => d !== edge.from) };
      });
      onChange({ ...workflow, phases, orche_nodes: orche });
    } else if (edge.type === "mapping") {
      const mappings = (workflow.field_mappings || []).filter(
        (m) => !(m.from_node === edge.from && m.to_node === edge.to && m.from_field === (edge.from_port || "") && m.to_field === (edge.to_port || ""))
      );
      onChange({ ...workflow, field_mappings: mappings });
    }
  };

  /** 우클릭 컨텍스트 메뉴 열기. */
  const handleContextMenu = (e: React.MouseEvent) => {
    const nodeEl = (e.target as Element).closest(".graph-node");
    if (!nodeEl) { setCtxMenu(null); return; }
    e.preventDefault();
    const nodeId = nodeEl.getAttribute("data-node-id");
    if (nodeId) {
      onSelectPhase(nodeId);
      setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
    }
  };

  /** 노드 삭제 (ID 기반). */
  const deleteNode = (id: string) => {
    const isPhase = workflow.phases.some((p) => p.phase_id === id);
    if (isPhase) {
      const phases = workflow.phases.filter((p) => p.phase_id !== id)
        .map((p) => ({ ...p, depends_on: p.depends_on?.filter((d) => d !== id) }));
      onChange({ ...workflow, phases });
    } else {
      onChange({
        ...workflow,
        orche_nodes: (workflow.orche_nodes || []).filter((n) => n.node_id !== id),
        trigger_nodes: (workflow.trigger_nodes || []).filter((n) => n.id !== id),
        tool_nodes: (workflow.tool_nodes || []).filter((n) => n.id !== id),
        skill_nodes: (workflow.skill_nodes || []).filter((n) => n.id !== id),
      });
    }
    onSelectPhase(null);
  };

  /** 컨텍스트 메뉴: 노드 삭제. */
  const ctxDelete = () => {
    if (!ctxMenu) return;
    deleteNode(ctxMenu.nodeId);
    setCtxMenu(null);
  };

  /** 노드 복제 (ID 기반). */
  const duplicateNode = (id: string) => {
    const phase = workflow.phases.find((p) => p.phase_id === id);
    if (phase) {
      const idx = workflow.phases.length + 1;
      const clone: PhaseDef = {
        ...JSON.parse(JSON.stringify(phase)),
        phase_id: `phase-${idx}`,
        title: `${phase.title} (copy)`,
        depends_on: phase.depends_on ? [...phase.depends_on] : undefined,
      };
      clone.agents = clone.agents.map((a, i) => ({ ...a, agent_id: `agent-${i + 1}` }));
      onChange({ ...workflow, phases: [...workflow.phases, clone] });
    } else {
      const orche = workflow.orche_nodes?.find((n) => n.node_id === id);
      if (orche) {
        const idx = (workflow.orche_nodes?.length || 0) + 1;
        const clone = { ...JSON.parse(JSON.stringify(orche)), node_id: `${orche.node_type}-${idx}`, title: `${orche.title} (copy)` };
        onChange({ ...workflow, orche_nodes: [...(workflow.orche_nodes || []), clone] });
      }
    }
  };

  /** 컨텍스트 메뉴: 노드 복제. */
  const ctxDuplicate = () => {
    if (!ctxMenu) return;
    duplicateNode(ctxMenu.nodeId);
    setCtxMenu(null);
  };

  /** Aggregator: depends_on >= 2인 노드 앞에 다이아몬드 합류점 표시. */
  const aggregators = (() => {
    const result: { x: number; y: number; phase_id: string }[] = [];
    for (const phase of workflow.phases) {
      if (!phase.depends_on || phase.depends_on.length < 2) continue;
      const pos = positions.get(phase.phase_id);
      if (!pos) continue;
      result.push({ x: pos.x - 16, y: pos.y + pos.height / 2, phase_id: phase.phase_id });
    }
    return result;
  })();

  /** 검색 결과: 매칭 노드 ID 목록. */
  const searchResults = (() => {
    if (!searchQuery.trim()) return [] as string[];
    const q = searchQuery.toLowerCase();
    const ids: string[] = [];
    // Phase 노드
    for (const p of workflow.phases) {
      if (p.phase_id.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) ids.push(p.phase_id);
    }
    // 보조 노드 (오케/트리거/채널 등)
    for (const n of auxData.nodes) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)) {
        ids.push(n.id);
      }
    }
    return ids;
  })();

  /** 검색 결과 선택 시 해당 노드로 팬 이동. */
  const focusNode = (nodeId: string) => {
    const pos = positions.get(nodeId);
    if (!pos) return;
    const cx = pos.x + pos.width / 2;
    const cy = pos.y + pos.height / 2;
    setPan({ x: cx - svgSize.w / zoom / 2, y: cy - svgSize.h / zoom / 2 });
    onSelectPhase(nodeId);
  };

  /** 키보드 단축키. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+F: 노드 검색 (입력 필드 내에서도 작동)
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      // Escape: 검색 닫기 우선
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
        return;
      }
      // 입력 필드 내에서는 무시
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") { onSelectPhase(null); return; }
      if (e.key === "=" || e.key === "+") { zoomIn(); return; }
      if (e.key === "-") { zoomOut(); return; }
      if (e.key === "0") { zoomReset(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPhaseId) {
        deleteNode(selectedPhaseId);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedPhaseId, workflow, onChange, onSelectPhase, searchOpen]);

  return (
    <div className="graph-editor">
      <svg
        ref={svgRef}
        className={`graph-editor__canvas${isPanning ? " graph-editor__canvas--panning" : ""}`}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={(e) => { setCtxMenu(null); handleCanvasMouseDown(e); }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDrag(null); setHandleDrag(null); setIsPanning(false); nodeDrag.current = null; selectDrag.current = null; setSelectRect(null); }}
        onContextMenu={handleContextMenu}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest(".graph-node")) addPhase();
        }}
      >
        <defs>
          <marker id="arrow-flow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line, #555)" />
          </marker>
          <marker id="arrow-goto" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--err, #e74c3c)" />
          </marker>
          <marker id="arrow-attach" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted, #6c7086)" />
          </marker>
          <marker id="arrow-trigger" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--orange, #e67e22)" />
          </marker>
          <marker id="arrow-config" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={6} markerHeight={6} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--yellow, #f1c40f)" />
          </marker>
          <marker id="arrow-mapping" viewBox="0 0 10 10" refX="10" refY="5" markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9b59b6" />
          </marker>
          <style>{`
            @keyframes node-pulse {
              0%, 100% { opacity: 0.3; stroke-width: 2; }
              50% { opacity: 0.8; stroke-width: 3; }
            }
            .node-running-glow {
              animation: node-pulse 1.5s ease-in-out infinite;
            }
          `}</style>
        </defs>

        {/* 그룹 프레임 (노드보다 뒤에 렌더링) */}
        {(workflow.groups || []).map((group) => (
          <GroupFrame
            key={group.group_id}
            group={group}
            positions={positions}
            onUpdate={(patch) => updateGroup(group.group_id, patch)}
            onDelete={() => deleteGroup(group.group_id)}
            onToggleCollapse={() => updateGroup(group.group_id, { collapsed: !group.collapsed })}
          />
        ))}

        {/* Edges */}
        {edges.map((edge, i) => (
          <EdgePath key={`${edge.from}-${edge.to}-${i}`} {...edge} positions={positions}
            onDelete={(edge.type === "flow" || edge.type === "mapping") ? () => deleteEdge(edge) : undefined}
            onInsert={edge.type === "flow" ? openPickerForEdge : undefined}
            graphNodes={auxData.nodes} phases={workflow.phases}
          />
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
            stroke="#9b59b6"
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0.7}
            pointerEvents="none"
          />
        )}

        {/* AddHandle 드래그 연결선 + 드롭 위치 인디케이터 */}
        {handleDrag && (() => {
          const { origin, mouse } = handleDrag;
          const dx = mouse.x - origin.x;
          const cpOffset = Math.max(40, Math.abs(dx) * 0.5);
          return (
            <g pointerEvents="none">
              <path
                d={`M ${origin.x} ${origin.y} C ${origin.x + cpOffset} ${origin.y}, ${mouse.x - cpOffset} ${mouse.y}, ${mouse.x} ${mouse.y}`}
                fill="none" stroke="var(--accent, #89b4fa)" strokeWidth={2} strokeDasharray="6 3" opacity={0.8}
              />
              <circle cx={mouse.x} cy={mouse.y} r={14} fill="var(--accent, #89b4fa)" fillOpacity={0.15} stroke="var(--accent, #89b4fa)" strokeWidth={1.5} />
              <text x={mouse.x} y={mouse.y} textAnchor="middle" dominantBaseline="central" fontSize={14} fill="var(--accent, #89b4fa)">+</text>
            </g>
          );
        })()}

        {/* Phase Nodes + AddHandle */}
        {workflow.phases.map((phase) => {
          const pos = positions.get(phase.phase_id);
          if (!pos) return null;
          return (
            <g key={phase.phase_id}>
              <PhaseNode
                phase={phase}
                pos={pos}
                isSelected={selectedPhaseId === phase.phase_id}
                isRunning={runningNodeId === phase.phase_id}
                onClick={() => {
                  if (multiSelectMode) {
                    setMultiSelected((prev) => { const n = new Set(prev); if (n.has(phase.phase_id)) n.delete(phase.phase_id); else n.add(phase.phase_id); return n; });
                  } else {
                    onSelectPhase(selectedPhaseId === phase.phase_id ? null : phase.phase_id);
                  }
                }}
                onDoubleClick={() => onEditPhase?.(phase.phase_id)}
                onPortDragStart={handlePortDragStart}
                onNodeDragStart={handleNodeDragStart}
                onNodeTouchStart={handleNodeTouchStart}
                onRunNode={onRunNode}
                subSlotCount={
                  phase.agents.length
                  + (phase.critic ? 1 : 0)
                  + (workflow.tool_nodes || []).filter((t) => t.attach_to?.includes(phase.phase_id)).length
                  + (workflow.skill_nodes || []).filter((s) => s.attach_to?.includes(phase.phase_id)).length
                }
              />
              <AddHandle pos={pos} onClick={() => openPickerFromHandle(phase.phase_id)}
                onDragStart={(origin) => setHandleDrag({ source_id: phase.phase_id, origin, mouse: origin })} />
            </g>
          );
        })}

        {/* Auxiliary Nodes (Tool/Skill/Cron/Channel) + AddHandle */}
        {auxData.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const isOrche = is_orche_type(node.type);
          return (
            <g key={node.id}>
              <AuxNode
                node={node}
                pos={pos}
                isRunning={runningNodeId === node.id}
                isSelected={selectedPhaseId === node.id}
                nodeStatus={orcheStates?.find((s) => s.node_id === node.id)?.status}
                onRunNode={onRunNode}
                onClick={(id) => {
                  if (multiSelectMode) {
                    setMultiSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
                  } else {
                    onSelectPhase(id);
                  }
                }}
                onDragStart={handleNodeDragStart}
                onTouchStart={handleNodeTouchStart}
                onDoubleClick={(id) => node.type === "sub_node" ? onEditSubNode?.(id) : onEditPhase?.(id)}
                onFieldDragStart={(nodeId, fieldName) => handlePortDragStart(nodeId, fieldName)}
              />
              {(isOrche || node.type === "trigger") && (
                <AddHandle pos={pos} onClick={() => openPickerFromHandle(node.id)}
                  onDragStart={(origin) => setHandleDrag({ source_id: node.id, origin, mouse: origin })} />
              )}
            </g>
          );
        })}

        {/* 선택 노드 상단 미니 액션 툴바 */}
        {selectedPhaseId && multiSelected.size < 2 && (() => {
          const selPos = positions.get(selectedPhaseId);
          if (!selPos) return null;
          const tbW = onRunNode ? 120 : 90;
          const tbH = 28;
          return (
            <foreignObject
              x={selPos.x + selPos.width / 2 - tbW / 2}
              y={selPos.y - tbH - 6}
              width={tbW} height={tbH}
              style={{ overflow: "visible" }}
            >
              <div className="graph-node-toolbar">
                <button title={t("workflows.edit") || "Edit"} onClick={(e) => { e.stopPropagation(); onEditPhase?.(selectedPhaseId); }}>✎</button>
                {onRunNode && (
                  <button title={t("workflows.run_node") || "Run"} onClick={(e) => { e.stopPropagation(); onRunNode(selectedPhaseId, "run"); }}>▶</button>
                )}
                <button title={t("workflows.duplicate") || "Duplicate"} onClick={(e) => { e.stopPropagation(); duplicateNode(selectedPhaseId); }}>⧉</button>
                <button title={t("workflows.remove_phase") || "Delete"} className="graph-node-toolbar__danger" onClick={(e) => { e.stopPropagation(); deleteNode(selectedPhaseId); }}>✕</button>
              </div>
            </foreignObject>
          );
        })()}

        {/* Marquee 선택 사각형 */}
        {selectRect && (
          <rect
            x={selectRect.x} y={selectRect.y}
            width={selectRect.w} height={selectRect.h}
            fill="var(--accent, #89b4fa)" fillOpacity={0.1}
            stroke="var(--accent, #89b4fa)" strokeDasharray="4 2" strokeWidth={1}
            pointerEvents="none"
          />
        )}
      </svg>

      {/* 좌하단: 줌 컨트롤 */}
      <div className="graph-editor__zoom-overlay">
        <button className="btn btn--sm btn--icon" onClick={zoomReset} title="Fit">⌂</button>
        <button className="btn btn--sm btn--icon" onClick={zoomIn} title="Zoom in">+</button>
        <button className="btn btn--sm btn--icon" onClick={zoomOut} title="Zoom out">−</button>
      </div>

      {/* 우상단: + 노드 추가 버튼 */}
      <button
        className="graph-editor__add-btn"
        title={t("workflows.add_node") || "Add node"}
        onClick={() => { setPickerSource(null); setPickerDropPos(null); setPickerOpen(true); }}
      >+</button>

      {/* 다중 선택 모드 바 */}
      {(multiSelectMode || multiSelected.size >= 2) && (
        <div className="graph-editor__multi-toolbar">
          <span>{multiSelected.size} {t("workflows.nodes_selected") || "nodes selected"}</span>
          {multiSelected.size >= 2 && (
            <button className="btn btn--sm btn--accent" onClick={createGroup}>
              {t("workflows.group_create") || "Group"}
            </button>
          )}
          <button className="btn btn--sm" onClick={() => { setMultiSelected(new Set()); setMultiSelectMode(false); }}>✕</button>
        </div>
      )}

      {/* NodePicker 사이드 패널 */}
      <NodePicker
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setPickerSource(null); setPickerDropPos(null); }}
        onSelect={handlePickerSelect}
        t={t}
      />

      {/* 빈 캔버스 안내 */}
      {workflow.phases.length === 0 && (
        <div className="graph-editor__empty">
          {t("workflows.empty_canvas")}
        </div>
      )}

      {/* 우클릭 컨텍스트 메뉴 */}
      {ctxMenu && (
        <>
          <div className="graph-ctx__backdrop" onClick={() => setCtxMenu(null)} />
          <div className="graph-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button className="graph-ctx__item" onClick={() => { onEditPhase?.(ctxMenu.nodeId); setCtxMenu(null); }}>
              ✎ {t("workflows.edit") || "Edit"}
            </button>
            {onRunNode && (
              <>
                <button className="graph-ctx__item" onClick={() => { onRunNode(ctxMenu.nodeId, "run"); setCtxMenu(null); }}>
                  ▶ {t("workflows.run_node") || "Run"}
                </button>
                <button className="graph-ctx__item" onClick={() => { onRunNode(ctxMenu.nodeId, "test"); setCtxMenu(null); }}>
                  ◇ {t("workflows.test_node") || "Test"}
                </button>
              </>
            )}
            <button className="graph-ctx__item" onClick={ctxDuplicate}>
              ⧉ {t("workflows.duplicate") || "Duplicate"}
            </button>
            <button className="graph-ctx__item graph-ctx__item--danger" onClick={ctxDelete}>
              ✕ {t("workflows.remove_phase") || "Delete"}
            </button>
          </div>
        </>
      )}

      {/* 노드 검색 오버레이 */}
      {searchOpen && (
        <div className="graph-editor__search">
          <input
            ref={searchRef}
            type="text"
            className="graph-editor__search-input"
            placeholder={t("workflows.search_nodes") || "Search nodes… (Esc to close)"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); }
              if (e.key === "Enter" && searchResults.length > 0) {
                focusNode(searchResults[0]!);
              }
            }}
          />
          {searchQuery && (
            <div className="graph-editor__search-results">
              {searchResults.length === 0 && <div className="graph-editor__search-empty">No results</div>}
              {searchResults.slice(0, 8).map((id) => {
                const phase = workflow.phases.find((p) => p.phase_id === id);
                const aux = auxData.nodes.find((n) => n.id === id);
                const label = phase?.title || aux?.label || id;
                const type = phase ? "phase" : aux?.type || "";
                return (
                  <button key={id} className="graph-editor__search-item" onClick={() => { focusNode(id); setSearchOpen(false); setSearchQuery(""); }}>
                    <span className="graph-editor__search-type">{type}</span>
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 하단 단축키 힌트 */}
      <div className="graph-editor__hints">
        <span>Scroll: Pan</span>
        <span>Ctrl+Scroll: Zoom</span>
        <span>Del: Delete</span>
        <span>Ctrl+F: Search</span>
        <span>Shift+Drag: Select</span>
        <span>0: Fit</span>
      </div>
    </div>
  );
}
