/** workspace/workflows/*.yaml 템플릿 로더 + 변수 치환. */

import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowDefinition, PhaseDefinition, ToolNodeDefinition, SkillNodeDefinition, WorkflowTriggerDefinition, HitlChannelDefinition, OrcheNodeRecord, FieldMapping, TriggerNodeRecord } from "../agent/phase-loop.types.js";

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

/** workspace/workflows/ 디렉토리에서 모든 .yaml/.yml 파일을 로드. */
export function load_workflow_templates(workspace: string): WorkflowDefinition[] {
  const dir = join(workspace, "workflows");
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const templates: WorkflowDefinition[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const raw = parse_yaml(content) as Record<string, unknown>;
      const def = normalize_workflow_definition(raw);
      if (def) templates.push(def);
    } catch { /* skip malformed files */ }
  }

  return templates;
}

/** 특정 워크플로우 템플릿을 이름으로 로드. */
export function load_workflow_template(workspace: string, name: string): WorkflowDefinition | null {
  const dir = join(workspace, "workflows");
  for (const ext of [".yaml", ".yml"]) {
    const path = join(dir, `${name}${ext}`);
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf-8");
      const raw = parse_yaml(content) as Record<string, unknown>;
      return normalize_workflow_definition(raw);
    } catch { return null; }
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
    return value !== undefined ? value.replace(/["\\\n\r\t]/g, (c) => `\\${c}`) : `{{${key}}}`;
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

/** raw YAML 객체를 WorkflowDefinition으로 정규화. */
function normalize_workflow_definition(raw: Record<string, unknown>): WorkflowDefinition | null {
  if (!raw.title || !raw.phases || !Array.isArray(raw.phases)) return null;

  const phases: PhaseDefinition[] = [];
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

  if (phases.length === 0) return null;

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
      }))
    : undefined;
  // 레거시 trigger → trigger_nodes 자동 변환
  if (!trigger_nodes && trigger) {
    trigger_nodes = [{ id: "__cron__", trigger_type: "cron", schedule: trigger.schedule, timezone: trigger.timezone }];
  }

  // 필드 매핑
  const field_mappings: FieldMapping[] | undefined = Array.isArray(raw.field_mappings)
    ? (raw.field_mappings as Array<Record<string, unknown>>).filter(
        (m) => m.from_node && m.from_field && m.to_node,
      ).map((m) => ({
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
