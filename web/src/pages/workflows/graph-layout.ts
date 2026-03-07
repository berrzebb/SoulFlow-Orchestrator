/**
 * Graph layout computation — pure functions, no React.
 * Topological layer assignment, position calculation, edge computation.
 */

import { get_output_fields, get_input_fields, TRIGGER_OUTPUT, CHANNEL_OUTPUT, CHANNEL_INPUT, END_INPUT } from "./output-schema";
import type { PhaseDef, WorkflowDef, NodeType, SubNodeType, TriggerNodeDef, GraphNode } from "./workflow-types";

// ── Layout Constants ──

export type NodePos = { x: number; y: number; width: number; height: number };

export const NODE_W = 220;
export const NODE_H = 100;
export const HEADER_H = 36;
export const AUX_W = 140;
export const GAP_X = 120;
export const GAP_Y = 40;
export const PADDING = 40;
export const SUB_D = 44;
export const SUB_GAP = 12;
export const SUB_OFFSET_Y = 24;

// ── Port Layout Constants ──

export const FIELD_PORT_R = 6;
export const ORCHE_MIN_H = 52;

/** Orchestration node fixed height. */
export function compute_orche_node_height(_field_count: number): number {
  return ORCHE_MIN_H;
}

/** Topological layer assignment based on depends_on + implicit sequential order. */
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
    if (!deps.length) return -1;
    has_explicit_deps.add(id);
    const max_dep = Math.max(...deps.map((d) => get_layer(d, visited)));
    const layer = (max_dep < 0 ? 0 : max_dep) + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const p of phases) get_layer(p.phase_id, new Set());

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

/** Phase effective height including sub-nodes. */
function phase_effective_height(phase: PhaseDef): number {
  const sub_count = phase.agents.length + (phase.critic ? 1 : 0);
  return sub_count > 0 ? NODE_H + SUB_OFFSET_Y + SUB_D : NODE_H;
}

/** Node position calculation — left-to-right horizontal flow. */
export function compute_positions(phases: PhaseDef[]): Map<string, NodePos> {
  const layers = compute_layers(phases);
  const positions = new Map<string, NodePos>();
  const phase_map = new Map(phases.map((p) => [p.phase_id, p]));

  const layer_groups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    if (!layer_groups.has(layer)) layer_groups.set(layer, []);
    layer_groups.get(layer)!.push(id);
  }

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

/** Auxiliary node + cluster sub-node position calculation. */
export function compute_aux_positions(
  workflow: WorkflowDef,
  phase_positions: Map<string, NodePos>,
): { nodes: GraphNode[]; positions: Map<string, NodePos> } {
  const nodes: GraphNode[] = [];
  const positions = new Map<string, NodePos>();
  const tool_nodes = workflow.tool_nodes || [];
  const skill_nodes = workflow.skill_nodes || [];

  // Cluster sub-nodes
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

  // Trigger nodes
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

  // Orchestration nodes
  const orche_nodes = workflow.orche_nodes || [];
  const all_positions = new Map(phase_positions);
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
      let placed = { x: anchor.x + anchor.width + GAP_X, y: anchor.y + y_offset, width: w, height: h };
      let attempts = 0;
      while (attempts < 20) {
        let collision = false;
        for (const [eid, ep] of all_positions) {
          if (eid === on.node_id) continue;
          if (placed.x < ep.x + ep.width && placed.x + placed.width > ep.x &&
              placed.y < ep.y + ep.height + GAP_Y / 2 && placed.y + placed.height > ep.y - GAP_Y / 2) {
            placed = { ...placed, y: ep.y + ep.height + GAP_Y };
            collision = true;
            break;
          }
        }
        if (!collision) break;
        attempts++;
      }
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

  // Channel node
  if (workflow.hitl_channel) {
    const ch_inputs = CHANNEL_INPUT;
    const ch_outputs = CHANNEL_OUTPUT;
    const ch_h = compute_orche_node_height(Math.max(ch_inputs.length, ch_outputs.length));

    const connected_phases = workflow.phases.filter((p) => p.mode === "interactive" || p.mode === "sequential_loop");
    const connected_positions = connected_phases.map((p) => phase_positions.get(p.phase_id)).filter(Boolean) as NodePos[];

    let x: number, y: number;
    if (connected_positions.length > 0) {
      const avg_x = connected_positions.reduce((s, p) => s + p.x + p.width / 2, 0) / connected_positions.length;
      const min_y = Math.min(...connected_positions.map((p) => p.y));
      x = avg_x - AUX_W / 2;
      y = min_y - ch_h - GAP_Y;
    } else {
      const last = workflow.phases[workflow.phases.length - 1];
      const anchor = last ? phase_positions.get(last.phase_id) : null;
      x = anchor ? anchor.x + anchor.width + 40 : PADDING + NODE_W + 40;
      y = anchor ? anchor.y - 40 : PADDING;
    }

    nodes.push({ id: "__channel__", type: "channel", label: workflow.hitl_channel.channel_type, sub_label: workflow.hitl_channel.chat_id, input_fields: ch_inputs, output_fields: ch_outputs });
    positions.set("__channel__", { x, y, width: AUX_W, height: ch_h });
  }

  // End (Output) nodes
  for (const en of workflow.end_nodes || []) {
    const end_inputs = END_INPUT;
    const end_h = ORCHE_MIN_H;
    const end_w = 160;

    let anchor: NodePos | null = null;
    for (const dep of en.depends_on || []) {
      const pos = all_positions.get(dep) || phase_positions.get(dep);
      if (pos) { anchor = pos; break; }
    }

    let x: number, y: number;
    if (anchor) {
      x = anchor.x + anchor.width + GAP_X;
      y = anchor.y;
    } else {
      let max_right = PADDING;
      let anchor_y = PADDING;
      for (const [, pos] of all_positions) {
        const right = pos.x + pos.width;
        if (right > max_right) { max_right = right; anchor_y = pos.y; }
      }
      for (const [, pos] of phase_positions) {
        const right = pos.x + pos.width;
        if (right > max_right) { max_right = right; anchor_y = pos.y; }
      }
      x = max_right + GAP_X;
      y = anchor_y;
    }

    let attempts = 0;
    while (attempts < 20) {
      let collision = false;
      for (const [eid, ep] of all_positions) {
        if (eid === en.node_id) continue;
        if (x < ep.x + ep.width && x + end_w > ep.x && y < ep.y + ep.height + GAP_Y / 2 && y + end_h > ep.y - GAP_Y / 2) {
          y = ep.y + ep.height + GAP_Y;
          collision = true;
          break;
        }
      }
      if (!collision) break;
      attempts++;
    }

    const targets = en.output_targets || [];
    const target_label = targets.length > 0 ? targets.join(", ") : "End";
    const effective_h = targets.length > 0 ? end_h + SUB_OFFSET_Y + SUB_D : end_h;

    nodes.push({
      id: en.node_id,
      type: "end",
      label: "End",
      sub_label: target_label,
      input_fields: end_inputs,
      output_fields: [],
    });
    positions.set(en.node_id, { x, y, width: end_w, height: end_h });
    all_positions.set(en.node_id, { x, y, width: end_w, height: effective_h });

    if (targets.length > 0) {
      const total_sub_w = targets.length * SUB_D + (targets.length - 1) * SUB_GAP;
      const sub_start_x = x + (end_w - total_sub_w) / 2;
      const sub_y = y + end_h + SUB_OFFSET_Y;
      targets.forEach((target, i) => {
        const sub_id = `${en.node_id}__end_${target}`;
        const sub_type = `end_${target}` as SubNodeType;
        nodes.push({ id: sub_id, type: "sub_node", label: target, sub_type, parent_end_id: en.node_id });
        positions.set(sub_id, { x: sub_start_x + i * (SUB_D + SUB_GAP), y: sub_y, width: SUB_D, height: SUB_D });
      });
    }
  }

  return { nodes, positions };
}

// ── Edge Types ──

export type EdgeType = "flow" | "goto" | "attach" | "trigger" | "config" | "mapping";

export type Edge = {
  from: string;
  to: string;
  from_port?: string;
  to_port?: string;
  type: EdgeType;
  label?: string;
};

/** Compute phase flow and goto edges. */
export function compute_edges(phases: PhaseDef[]): Edge[] {
  const edges: Edge[] = [];
  const id_set = new Set(phases.map((p) => p.phase_id));

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;

    if (phase.depends_on?.length) {
      for (const dep of phase.depends_on) {
        if (id_set.has(dep)) edges.push({ from: dep, to: phase.phase_id, type: "flow", from_port: "result", to_port: "prompt" });
      }
    } else if (i > 0) {
      edges.push({ from: phases[i - 1]!.phase_id, to: phase.phase_id, type: "flow", from_port: "result", to_port: "prompt" });
    }

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

/** Compute auxiliary edges (cluster, orchestration, trigger, config, field mapping). */
export function compute_aux_edges(workflow: WorkflowDef): Edge[] {
  const edges: Edge[] = [];

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

  for (const on of workflow.orche_nodes || []) {
    for (const dep of on.depends_on || []) {
      edges.push({ from: dep, to: on.node_id, type: "flow" });
    }
  }

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

  if (workflow.hitl_channel) {
    for (const p of workflow.phases) {
      if (p.mode === "interactive" || p.mode === "sequential_loop") {
        edges.push({ from: "__channel__", to: p.phase_id, type: "config", to_port: "channel" });
      }
    }
  }

  for (const en of workflow.end_nodes || []) {
    for (const dep of en.depends_on || []) {
      edges.push({ from: dep, to: en.node_id, type: "flow", from_port: "result", to_port: "result" });
    }
    for (const target of en.output_targets || []) {
      edges.push({ from: en.node_id, to: `${en.node_id}__end_${target}`, type: "attach" });
    }
  }

  for (const m of workflow.field_mappings || []) {
    edges.push({ from: m.from_node, to: m.to_node, from_port: m.from_field, to_port: m.to_field, type: "mapping", label: m.from_field });
  }

  return edges;
}
