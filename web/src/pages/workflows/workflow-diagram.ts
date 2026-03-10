/** WorkflowDef → Mermaid 다이어그램 변환 (프론트엔드 전용 순수 함수). */

import type { WorkflowDef } from "./workflow-types";

const TRIGGER_ICONS: Record<string, string> = {
  cron: "⏰", webhook: "↗", manual: "▶", channel_message: "💬", kanban_event: "📋", filesystem_watch: "📁",
};
const MODE_ICONS: Record<string, string> = {
  sequential_loop: "🔁", interactive: "🔄", parallel: "⚡",
};

function mid(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, "_"); }
function mlabel(s: string, max = 36): string {
  const clean = s.replace(/"/g, "'").replace(/\n/g, " ");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export function workflow_def_to_mermaid(def: WorkflowDef, type: "flowchart" | "sequence"): string {
  return type === "flowchart" ? to_flowchart(def) : to_sequence(def);
}

function to_flowchart(def: WorkflowDef): string {
  const lines: string[] = ["flowchart LR"];
  const phase_ids = new Set(def.phases.map((p) => p.phase_id));

  for (const tn of def.trigger_nodes || []) {
    const icon = TRIGGER_ICONS[tn.trigger_type] || "▶";
    const detail = tn.schedule || tn.trigger_type;
    lines.push(`  ${mid(tn.id)}(["${icon} ${mlabel(detail)}"])`);
  }

  for (const p of def.phases) {
    const mode_icon = MODE_ICONS[p.mode || "parallel"];
    const agents_label = `${p.agents.length}a${p.critic ? "+c" : ""}`;
    lines.push(`  ${mid(p.phase_id)}["${mlabel(p.title || p.phase_id)}<br/>${mode_icon} ${agents_label}"]`);
  }

  for (const on of def.orche_nodes || []) {
    if (on.node_type === "if" || on.node_type === "switch") {
      lines.push(`  ${mid(on.node_id)}{{"${mlabel(on.title || on.node_id)}"}}`);
    } else {
      lines.push(`  ${mid(on.node_id)}["${mlabel(on.title || on.node_id)}<br/>${on.node_type}"]`);
    }
  }

  for (const en of def.end_nodes || []) {
    lines.push(`  ${mid(en.node_id)}(["⏹ ${mlabel(en.output_targets?.join(", ") || "End")}"])`);
  }

  lines.push("");

  for (const tn of def.trigger_nodes || []) {
    const target = def.phases.find((p) => p.depends_on?.includes(tn.id));
    if (target) lines.push(`  ${mid(tn.id)} --> ${mid(target.phase_id)}`);
  }

  for (const p of def.phases) {
    for (const dep of p.depends_on || []) {
      if (phase_ids.has(dep)) lines.push(`  ${mid(dep)} --> ${mid(p.phase_id)}`);
    }
    if (p.critic?.on_rejection === "goto" && p.critic.goto_phase && phase_ids.has(p.critic.goto_phase)) {
      lines.push(`  ${mid(p.phase_id)} -.->|FAIL| ${mid(p.critic.goto_phase)}`);
    }
  }

  for (const on of def.orche_nodes || []) {
    for (const dep of on.depends_on || []) {
      lines.push(`  ${mid(dep)} --> ${mid(on.node_id)}`);
    }
  }

  for (const en of def.end_nodes || []) {
    for (const dep of en.depends_on || []) {
      lines.push(`  ${mid(dep)} --> ${mid(en.node_id)}`);
    }
  }

  return lines.join("\n");
}

function to_sequence(def: WorkflowDef): string {
  const lines: string[] = ["sequenceDiagram", "  autonumber"];
  const phase_map = new Map(def.phases.map((p) => [p.phase_id, p]));

  for (const tn of def.trigger_nodes || []) {
    const icon = TRIGGER_ICONS[tn.trigger_type] || "▶";
    lines.push(`  participant ${mid(tn.id)} as ${icon} ${mlabel(tn.trigger_type, 24)}`);
  }
  for (const p of def.phases) {
    const mode_icon = MODE_ICONS[p.mode || "parallel"];
    lines.push(`  participant ${mid(p.phase_id)} as ${mode_icon} ${mlabel(p.title || p.phase_id, 28)}`);
    if (p.critic) lines.push(`  participant ${mid(p.phase_id)}_c as ⚖`);
  }
  lines.push("");

  for (const tn of def.trigger_nodes || []) {
    const target = def.phases.find((p) => p.depends_on?.includes(tn.id));
    if (target) lines.push(`  ${mid(tn.id)}->>+${mid(target.phase_id)}: trigger`);
  }

  const visited = new Set<string>();
  const emit_phase = (p: WorkflowDef["phases"][0]) => {
    if (visited.has(p.phase_id)) return;
    visited.add(p.phase_id);
    if (p.mode === "sequential_loop") {
      lines.push(`  loop ${mlabel(p.loop_until || "until done", 30)}`);
    }
    for (const a of p.agents) {
      lines.push(`  Note over ${mid(p.phase_id)}: ${mlabel(a.label || a.agent_id, 28)}`);
    }
    if (p.critic) {
      lines.push(`  ${mid(p.phase_id)}->>+${mid(p.phase_id)}_c: review`);
      lines.push(`  ${mid(p.phase_id)}_c-->>-${mid(p.phase_id)}: gate`);
    }
    if (p.mode === "sequential_loop") lines.push("  end");
    lines.push(`  ${mid(p.phase_id)}-->>-${mid(p.phase_id)}: done`);
  };

  for (const p of def.phases) {
    for (const dep of p.depends_on || []) {
      const dep_phase = phase_map.get(dep);
      if (dep_phase) emit_phase(dep_phase);
    }
    emit_phase(p);
  }

  return lines.join("\n");
}
