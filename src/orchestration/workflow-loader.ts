/** workspace/workflows/*.yaml 템플릿 로더 + 변수 치환. */

import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinition, PhaseDefinition, ToolNodeDefinition, SkillNodeDefinition, WorkflowTriggerDefinition, HitlChannelDefinition, OrcheNodeRecord, FieldMapping, TriggerNodeRecord } from "../agent/phase-loop.types.js";
import type { WorkflowNodeDefinition } from "../agent/workflow-node.types.js";

/** YAML 의존성 없이 간단한 YAML-like 파싱 (JSON 직렬화된 YAML 지원). */
let yaml_parse: ((text: string) => unknown) | null = null;
let yaml_dump: ((obj: unknown) => string) | null = null;
try {
  const mod_name = "js-yaml";
  const mod = await import(/* webpackIgnore: true */ mod_name) as { load: (text: string) => unknown; dump: (obj: unknown) => string };
  yaml_parse = mod.load;
  yaml_dump = mod.dump;
} catch {
  // js-yaml 미설치 시 JSON 폴백
}

function parse_yaml(text: string): unknown {
  if (yaml_parse) return yaml_parse(text);
  return JSON.parse(text);
}

/** 템플릿 + 파일명 slug + 별칭. */
export type TemplateWithSlug = WorkflowDefinition & { slug: string; aliases?: string[] };

/** workspace/workflows/ 디렉토리에서 모든 .yaml/.yml 파일을 로드. */
export function load_workflow_templates(workspace: string): TemplateWithSlug[] {
  const dir = join(workspace, "workflows");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const templates: TemplateWithSlug[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const raw = parse_yaml(content) as Record<string, unknown>;
      const def = normalize_workflow_definition(raw);
      if (def) {
        const aliases = Array.isArray(raw.aliases) ? raw.aliases.map(String) : undefined;
        templates.push({ ...def, slug: file.replace(/\.(yaml|yml)$/, ""), aliases });
      }
    } catch { /* skip malformed files */ }
  }

  return templates;
}

/** 특정 워크플로우 템플릿을 이름(slug) 또는 title로 로드. */
export function load_workflow_template(workspace: string, name: string): WorkflowDefinition | null {
  const dir = join(workspace, "workflows");
  if (!existsSync(dir)) return null;

  // 1차: 파일명(slug) exact match
  for (const ext of [".yaml", ".yml"]) {
    const path = join(dir, `${name}${ext}`);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf-8");
      const raw = parse_yaml(content) as Record<string, unknown>;
      return normalize_workflow_definition(raw);
    } catch { return null; }
  }

  // 2차: title + aliases 매칭 (대소문자 무시, 부분 일치)
  const lower = name.toLowerCase();
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const raw = parse_yaml(content) as Record<string, unknown>;

      // title 매칭
      const title = String(raw.title || "").toLowerCase();
      if (title && (title === lower || title.includes(lower) || lower.includes(title))) {
        return normalize_workflow_definition(raw);
      }

      // aliases 매칭
      const aliases = Array.isArray(raw.aliases) ? raw.aliases.map((a) => String(a).toLowerCase()) : [];
      if (aliases.some((a) => a === lower || a.includes(lower) || lower.includes(a))) {
        return normalize_workflow_definition(raw);
      }
    } catch { /* skip */ }
  }

  return null;
}

/** 변수 치환: `{{key}}` → value. */
export function substitute_variables(
  definition: WorkflowDefinition,
  vars: Record<string, string>,
): WorkflowDefinition {
  const json = JSON.stringify(definition);
  const substituted = json.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    // JSON 문자열 내부이므로 특수문자 이스케이프
    if (value === undefined) return `{{${key}}}`;
    return value.replace(/["\\\n\r\t]/g, (c) => {
      if (c === "\n") return "\\n";
      if (c === "\r") return "\\r";
      if (c === "\t") return "\\t";
      return `\\${c}`;
    });
  });
  return JSON.parse(substituted) as WorkflowDefinition;
}

/** 이름을 파일명 안전한 slug로 변환. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9가-힣\-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

/** 워크플로우 디렉토리 경로. */
function workflows_dir(workspace: string): string {
  const dir = join(workspace, "workflows");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 워크플로우 템플릿을 YAML로 저장. */
export function save_workflow_template(workspace: string, name: string, definition: WorkflowDefinition): string {
  const slug = slugify(name);
  const dir = workflows_dir(workspace);
  const path = join(dir, `${slug}.yaml`);
  const content = yaml_dump ? yaml_dump(definition) : JSON.stringify(definition, null, 2);
  writeFileSync(path, content, "utf-8");
  return slug;
}

/** 워크플로우 템플릿 삭제. */
export function delete_workflow_template(workspace: string, name: string): boolean {
  const dir = join(workspace, "workflows");
  if (!existsSync(dir)) return false;
  for (const ext of [".yaml", ".yml"]) {
    const path = join(dir, `${name}${ext}`);
    if (existsSync(path)) { unlinkSync(path); return true; }
  }
  return false;
}

/** YAML 텍스트를 파싱하여 WorkflowDefinition으로 변환. */
export function parse_workflow_yaml(yaml_content: string): WorkflowDefinition | null {
  const raw = parse_yaml(yaml_content) as Record<string, unknown>;
  return normalize_workflow_definition(raw);
}

/** YAML 직렬화: WorkflowDefinition → YAML 문자열. */
export function serialize_to_yaml(definition: WorkflowDefinition): string {
  return yaml_dump ? yaml_dump(definition) : JSON.stringify(definition, null, 2);
}

/** normalize를 외부에서도 사용할 수 있도록 export. */
export { normalize_workflow_definition };

// ── Diagram Export ──────────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<string, string> = {
  cron: "⏰", webhook: "↗", manual: "▶", channel_message: "💬", kanban_event: "📋", filesystem_watch: "📁",
};
const MODE_ICONS: Record<string, string> = {
  sequential_loop: "🔁", interactive: "🔄", parallel: "⚡",
};

/** Mermaid-safe ID: 영숫자 + 하이픈 + 밑줄만 허용. */
function mid(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, "_"); }
/** Mermaid 레이블 안전 처리: 큰따옴표·개행 제거. */
function mlabel(s: string, max = 36): string { return s.replace(/"/g, "'").replace(/\n/g, " ").slice(0, max); }

/** WorkflowDefinition → Mermaid flowchart LR 다이어그램 문자열. */
export function workflow_to_flowchart(def: WorkflowDefinition): string {
  const lines: string[] = ["```mermaid", "flowchart LR"];
  const phase_ids = new Set((def.phases || []).map((p) => p.phase_id));

  for (const tn of def.trigger_nodes || []) {
    const icon = TRIGGER_ICONS[tn.trigger_type] || "▶";
    const detail = tn.schedule || tn.webhook_path || tn.channel_type || tn.trigger_type;
    lines.push(`  ${mid(tn.id)}(["${icon} ${mlabel(detail)}"])`);
  }

  for (const p of def.phases || []) {
    const mode_icon = MODE_ICONS[p.mode || "parallel"];
    const agents_label = `${p.agents.length}a${p.critic ? "+c" : ""}`;
    lines.push(`  ${mid(p.phase_id)}["${mlabel(p.title || p.phase_id)}\\n${mode_icon} ${agents_label}"]`);
  }

  for (const on of def.orche_nodes || []) {
    if (on.node_type === "if" || on.node_type === "switch") {
      lines.push(`  ${mid(on.node_id)}{{"${mlabel(on.title || on.node_id)}"}}`);
    } else {
      lines.push(`  ${mid(on.node_id)}["${mlabel(on.title || on.node_id)}\\n${on.node_type}"]`);
    }
  }

  for (const en of def.end_nodes || []) {
    lines.push(`  ${mid(en.node_id)}(["⏹ ${mlabel(en.output_targets?.join(", ") || "End")}"])`);
  }

  lines.push("");

  for (const tn of def.trigger_nodes || []) {
    const target = (def.phases || []).find((p) => p.depends_on?.includes(tn.id));
    if (target) lines.push(`  ${mid(tn.id)} --> ${mid(target.phase_id)}`);
  }

  for (const p of def.phases || []) {
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

  lines.push("```");
  return lines.join("\n");
}

/** WorkflowDefinition → Mermaid sequenceDiagram 문자열 (실행 흐름 시각화). */
export function workflow_to_sequence(def: WorkflowDefinition): string {
  const lines: string[] = ["```mermaid", "sequenceDiagram"];
  lines.push("  autonumber");

  const participants: string[] = [];
  for (const tn of def.trigger_nodes || []) {
    const icon = TRIGGER_ICONS[tn.trigger_type] || "▶";
    participants.push(`  participant ${mid(tn.id)} as ${icon} ${mlabel(tn.trigger_type, 20)}`);
  }
  for (const p of def.phases || []) {
    const mode_icon = MODE_ICONS[p.mode || "parallel"];
    participants.push(`  participant ${mid(p.phase_id)} as ${mode_icon} ${mlabel(p.title || p.phase_id, 20)}`);
    if (p.critic) participants.push(`  participant ${mid(p.phase_id)}_critic as ⚖ Critic`);
  }
  lines.push(...participants, "");

  // 트리거 → 페이즈 이벤트
  for (const tn of def.trigger_nodes || []) {
    const target = (def.phases || []).find((p) => p.depends_on?.includes(tn.id));
    if (target) lines.push(`  ${mid(tn.id)}->>+${mid(target.phase_id)}: trigger`);
  }

  // 페이즈 실행 흐름 (depends_on 순서대로)
  const phase_map = new Map((def.phases || []).map((p) => [p.phase_id, p]));
  const visited = new Set<string>();
  const emit_phase = (p: typeof def.phases extends Array<infer T> ? T : never) => {
    if (visited.has(p.phase_id)) return;
    visited.add(p.phase_id);
    if (p.mode === "sequential_loop") {
      lines.push(`  loop ${mlabel(p.loop_until || "loop", 30)}`);
    }
    for (const a of p.agents) {
      lines.push(`  ${mid(p.phase_id)}->>+${mid(p.phase_id)}: ${mlabel(a.label || a.agent_id, 20)}`);
    }
    if (p.critic) {
      lines.push(`  ${mid(p.phase_id)}->>+${mid(p.phase_id)}_critic: review`);
      lines.push(`  ${mid(p.phase_id)}_critic-->>-${mid(p.phase_id)}: gate result`);
    }
    if (p.mode === "sequential_loop") lines.push("  end");
    lines.push(`  ${mid(p.phase_id)}-->>-${mid(p.phase_id)}: done`);
  };

  // 의존성 순서로 페이즈 출력
  for (const p of def.phases || []) {
    for (const dep of p.depends_on || []) {
      const dep_phase = phase_map.get(dep);
      if (dep_phase) emit_phase(dep_phase);
    }
    emit_phase(p);
  }

  lines.push("```");
  return lines.join("\n");
}

/** raw YAML 객체를 WorkflowDefinition으로 정규화. */
function normalize_workflow_definition(raw: Record<string, unknown>): WorkflowDefinition | null {
  if (!raw.title) return null;

  const has_phases = Array.isArray(raw.phases);
  const has_nodes = Array.isArray(raw.nodes);
  if (!has_phases && !has_nodes) return null;

  // ── nodes 배열 파싱 (통합 DAG: phase + orche + trigger) ──
  const nodes: WorkflowNodeDefinition[] | undefined = has_nodes
    ? (raw.nodes as Array<Record<string, unknown>>).filter(
        (n) => n.node_id && n.node_type,
      ).map((n) => ({
        ...n,
        node_id: String(n.node_id),
        node_type: String(n.node_type),
        title: String(n.title || n.node_id || ""),
        depends_on: Array.isArray(n.depends_on) ? n.depends_on.map(String) : undefined,
      }) as WorkflowNodeDefinition)
    : undefined;

  // ── phases 배열 파싱 (레거시 또는 병행) ──
  const phases: PhaseDefinition[] = [];
  if (has_phases) {
    for (const p of raw.phases as Array<Record<string, unknown>>) {
      if (!p.phase_id || !Array.isArray(p.agents)) continue;
      phases.push({
        phase_id: String(p.phase_id),
        title: String(p.title || p.phase_id),
        agents: (p.agents as Array<Record<string, unknown>>).map((a) => ({
          agent_id: String(a.agent_id || a.role || `agent-${Math.random().toString(36).slice(2, 8)}`),
          role: String(a.role || ""),
          label: String(a.label || a.role || ""),
          backend: String(a.backend || "codex_cli"),
          model: a.model ? String(a.model) : undefined,
          system_prompt: String(a.system_prompt || ""),
          tools: Array.isArray(a.tools) ? a.tools.map(String) : undefined,
          max_turns: a.max_turns ? Number(a.max_turns) : undefined,
        })),
        critic: p.critic ? {
          backend: String((p.critic as Record<string, unknown>).backend || "codex_cli"),
          model: (p.critic as Record<string, unknown>).model ? String((p.critic as Record<string, unknown>).model) : undefined,
          system_prompt: String((p.critic as Record<string, unknown>).system_prompt || ""),
          gate: Boolean((p.critic as Record<string, unknown>).gate ?? true),
          on_rejection: ((p.critic as Record<string, unknown>).on_rejection as PhaseDefinition["critic"] extends { on_rejection?: infer R } ? R : undefined) || undefined,
          max_retries: (p.critic as Record<string, unknown>).max_retries ? Number((p.critic as Record<string, unknown>).max_retries) : undefined,
          goto_phase: (p.critic as Record<string, unknown>).goto_phase ? String((p.critic as Record<string, unknown>).goto_phase) : undefined,
        } : undefined,
        context_template: p.context_template ? String(p.context_template) : undefined,
        failure_policy: (p.failure_policy as PhaseDefinition["failure_policy"]) || undefined,
        quorum_count: p.quorum_count ? Number(p.quorum_count) : undefined,
        mode: (p.mode as PhaseDefinition["mode"]) || undefined,
        loop_until: p.loop_until ? String(p.loop_until) : undefined,
        max_loop_iterations: p.max_loop_iterations ? Number(p.max_loop_iterations) : undefined,
        depends_on: Array.isArray(p.depends_on) ? p.depends_on.map(String) : undefined,
        tools: Array.isArray(p.tools) ? p.tools.map(String) : undefined,
        skills: Array.isArray(p.skills) ? p.skills.map(String) : undefined,
      });
    }
  }

  // nodes도 없고 파싱된 phases도 비어있으면 무효
  if (!nodes?.length && phases.length === 0) return null;

  // 보조 노드 파싱
  const tool_nodes: ToolNodeDefinition[] | undefined = Array.isArray(raw.tool_nodes)
    ? (raw.tool_nodes as Array<Record<string, unknown>>).map((n) => ({
        id: String(n.id || ""),
        tool_id: String(n.tool_id || ""),
        description: String(n.description || n.tool_id || ""),
        attach_to: Array.isArray(n.attach_to) ? n.attach_to.map(String) : undefined,
      }))
    : undefined;

  const skill_nodes: SkillNodeDefinition[] | undefined = Array.isArray(raw.skill_nodes)
    ? (raw.skill_nodes as Array<Record<string, unknown>>).map((n) => ({
        id: String(n.id || ""),
        skill_name: String(n.skill_name || ""),
        description: String(n.description || n.skill_name || ""),
        attach_to: Array.isArray(n.attach_to) ? n.attach_to.map(String) : undefined,
      }))
    : undefined;

  const trigger: WorkflowTriggerDefinition | undefined =
    raw.trigger && typeof raw.trigger === "object" && (raw.trigger as Record<string, unknown>).type === "cron"
      ? {
          type: "cron" as const,
          schedule: String((raw.trigger as Record<string, unknown>).schedule || ""),
          timezone: (raw.trigger as Record<string, unknown>).timezone ? String((raw.trigger as Record<string, unknown>).timezone) : undefined,
        }
      : undefined;

  const hitl_channel: HitlChannelDefinition | undefined =
    raw.hitl_channel && typeof raw.hitl_channel === "object"
      ? {
          channel_type: String((raw.hitl_channel as Record<string, unknown>).channel_type || ""),
          chat_id: (raw.hitl_channel as Record<string, unknown>).chat_id ? String((raw.hitl_channel as Record<string, unknown>).chat_id) : undefined,
        }
      : undefined;

  // 오케스트레이션 노드 (UI에서 추가한 HTTP/Code/IF/Merge/Set)
  const orche_nodes: OrcheNodeRecord[] | undefined = Array.isArray(raw.orche_nodes)
    ? (raw.orche_nodes as Array<Record<string, unknown>>).filter(
        (n) => n.node_id && n.node_type,
      ).map((n) => ({
        ...n,
        node_id: String(n.node_id),
        node_type: String(n.node_type) as OrcheNodeRecord["node_type"],
        title: String(n.title || n.node_id || ""),
        depends_on: Array.isArray(n.depends_on) ? n.depends_on.map(String) : undefined,
      }))
    : undefined;

  // 트리거 노드 (복수 지원 + 레거시 trigger → trigger_nodes 변환)
  let trigger_nodes: TriggerNodeRecord[] | undefined = Array.isArray(raw.trigger_nodes)
    ? (raw.trigger_nodes as Array<Record<string, unknown>>).filter(
        (n) => n.id && n.trigger_type,
      ).map((n) => ({
        id: String(n.id),
        trigger_type: String(n.trigger_type) as TriggerNodeRecord["trigger_type"],
        schedule: n.schedule ? String(n.schedule) : undefined,
        timezone: n.timezone ? String(n.timezone) : undefined,
        webhook_path: n.webhook_path ? String(n.webhook_path) : undefined,
        channel_type: n.channel_type ? String(n.channel_type) : undefined,
        chat_id: n.chat_id ? String(n.chat_id) : undefined,
        kanban_board_id: n.kanban_board_id ? String(n.kanban_board_id) : undefined,
        kanban_actions: Array.isArray(n.kanban_actions) ? n.kanban_actions.map(String) : undefined,
        kanban_column_id: n.kanban_column_id ? String(n.kanban_column_id) : undefined,
      }))
    : undefined;
  // 레거시 trigger → trigger_nodes 자동 변환
  if (!trigger_nodes && trigger) {
    trigger_nodes = [{ id: "__cron__", trigger_type: "cron", schedule: trigger.schedule, timezone: trigger.timezone }];
  }

  // 필드 매핑 — 중복 및 존재하지 않는 노드 참조 제거
  const valid_node_ids = new Set<string>([
    ...phases.map((p) => p.phase_id),
    ...(trigger_nodes || []).map((t) => t.id),
    ...(orche_nodes || []).map((n) => n.node_id),
    ...(tool_nodes || []).map((t) => t.id),
    ...(skill_nodes || []).map((s) => s.id),
    ...(hitl_channel ? ["__channel__"] : []),
  ]);
  const seen_mappings = new Set<string>();
  const field_mappings: FieldMapping[] | undefined = Array.isArray(raw.field_mappings)
    ? (raw.field_mappings as Array<Record<string, unknown>>).filter((m) => {
        if (!m.from_node || !m.from_field || !m.to_node) return false;
        const from = String(m.from_node), to = String(m.to_node);
        // 존재하지 않는 노드 참조 제거
        if (!valid_node_ids.has(from) || !valid_node_ids.has(to)) return false;
        // 중복 제거
        const key = `${from}→${to}:${m.from_field}→${m.to_field || ""}`;
        if (seen_mappings.has(key)) return false;
        seen_mappings.add(key);
        return true;
      }).map((m) => ({
        from_node: String(m.from_node),
        from_field: String(m.from_field),
        to_node: String(m.to_node),
        to_field: String(m.to_field || ""),
      }))
    : undefined;

  return {
    title: String(raw.title),
    objective: String(raw.objective || ""),
    phases,
    nodes,
    variables: raw.variables && typeof raw.variables === "object"
      ? Object.fromEntries(Object.entries(raw.variables as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined,
    tool_nodes,
    skill_nodes,
    trigger,
    trigger_nodes,
    hitl_channel,
    orche_nodes,
    field_mappings,
  };
}
