/**
 * WorkflowTool — 에이전트가 워크플로우를 CRUD + 실행할 수 있는 도구.
 * 자연어 → DAG 변환은 에이전트(LLM)가 담당, 이 도구는 구조화된 정의를 저장/실행.
 */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import type { DashboardWorkflowOps, DashboardAgentProviderOps } from "../../dashboard/service.js";
import { normalize_workflow_definition, slugify, workflow_to_flowchart, workflow_to_sequence } from "../../orchestration/workflow-loader.js";
import { build_node_catalog } from "./workflow-catalog.js";
import { select_nodes_for_request } from "../../orchestration/node-selector.js";
import { get_all_handlers } from "../node-registry.js";
import { register_all_nodes } from "../nodes/index.js";

export class WorkflowTool extends Tool {
  readonly name = "workflow";
  readonly category = "external" as const;
  readonly description =
    "IMPORTANT: 워크플로우 생성·수정은 반드시 이 도구(create/update action)를 사용한다. write_file로 YAML을 직접 쓰지 말 것.\n" +
    "create/update 호출 시 workspace/workflows/<slug>.yaml에 자동 저장된다. read_file로 현재 YAML 확인만 가능.\n" +
    "\n" +
    "## 워크플로우 작성 순서 (반드시 준수)\n" +
    "1. models 호출 → 사용 가능한 backend ID와 model ID 확인\n" +
    "2. node_types 호출 → 노드 타입 카탈로그 확인 (DAG Style B 사용 시)\n" +
    "3. create 호출 — 아래 검증 통과 후에만\n" +
    "\n" +
    "## 에이전트 역할(role) 작성 기준\n" +
    "agents[].role 값은 src/skills/roles/ 하위 역할을 따른다.\n" +
    "표준 역할: implementer, debugger, reviewer, validator, pl, pm, concierge, generalist\n" +
    "커스텀 역할 작성 시: 해당 SKILL.md의 soul/heart를 read_file로 읽어 system_prompt에 반영한다.\n" +
    "\n" +
    "## create 전 필수 검증\n" +
    "- [ ] 모든 phase에 phase_id가 있는가?\n" +
    "- [ ] 모든 phase의 agents[]가 비어 있지 않은가?\n" +
    "- [ ] backend 값이 실제 조회한 backend ID와 일치하는가?\n" +
    "- [ ] closed-loop 사용 시: goto_phase가 실제로 존재하는 phase_id인가?\n" +
    "- [ ] closed-loop 사용 시: 비평 phase가 goto_phase보다 뒤에 오는가?\n" +
    "하나라도 아니면 definition을 수정하고 다시 검증한다.\n" +
    "\n" +
    "## 최소 구조 예시 (phases 기반)\n" +
    '{"title":"요약","phases":[{"phase_id":"draft","agents":[{"agent_id":"a1","role":"writer","backend":"<backend_id>","system_prompt":"요약하라"}]},{"phase_id":"review","agents":[{"agent_id":"a2","role":"reviewer","backend":"<backend_id>","system_prompt":"검토하라"}],"critic":{"backend":"<backend_id>","gate":true,"on_rejection":"goto","goto_phase":"draft","max_retries":3,"system_prompt":"APPROVED 또는 REJECTED\\n이유:"}}]}\n' +
    "\n" +
    "## Closed-Loop (Critic + Goto) 패턴\n" +
    "품질 기준 통과 시까지 자동 재시도하는 루프:\n" +
    "1. 최종 검토 phase에 critic 추가, gate: true 설정\n" +
    "2. on_rejection: 'goto', goto_phase: '<이전_phase_id>' 설정\n" +
    "3. critic system_prompt는 반드시 APPROVED / REJECTED 판정을 명시적으로 출력해야 함\n" +
    "전체 스키마: node_types 호출로 확인.\n" +
    "\n" +
    "## 수정 흐름\n" +
    "get name=<slug>(현재 확인) → (definition 수정) → update name=<slug>(자동 YAML 저장) → flowchart name=<slug>(시각화)\n" +
    "\n" +
    "Actions: create, list, get, run, update, delete, export, flowchart, sequence, node_types, models";

  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "get", "run", "update", "delete", "export", "flowchart", "sequence", "node_types", "models"],
        description: "Action to perform. flowchart: Mermaid flowchart LR diagram. sequence: Mermaid sequence diagram. node_types: show available node type catalog. models: list backends and models.",
      },
      name: { type: "string", description: "Workflow template name or slug" },
      definition: {
        type: "object",
        description:
          "WorkflowDefinition object (for create/update/run-inline). " +
          "Phase-based: { title, phases: [{ phase_id, agents: [{agent_id, role, backend, system_prompt}], critic?: { backend, gate, on_rejection, goto_phase, max_retries, system_prompt } }] }. " +
          "Orche-based: { title, orche_nodes: [{ node_id, node_type, title, depends_on?, ...params }] }. " +
          "agents[].role: use standard roles (implementer/debugger/reviewer/validator/pl/pm/concierge/generalist) or extended roles (researcher/writer/analyst/summarizer/extractor). " +
          "agents[].system_prompt: include role declaration + input context + output format. For standard roles, read src/skills/roles/<role>/SKILL.md soul/heart and reflect in prompt. " +
          "critic.system_prompt: must explicitly output APPROVED or REJECTED with reason. REJECTED must include improvement instructions for next iteration. " +
          "critic.backend: required field — must be set to a valid backend ID from models action. " +
          "For closed-loop: set critic.on_rejection='goto' and critic.goto_phase to an earlier phase_id. " +
          "Call node_types action to see the complete schema with all options and examples.",
      },
      variables: {
        type: "object",
        description: "Variable overrides when running a workflow (for run action)",
      },
      node_categories: {
        type: "array",
        items: { type: "string" },
        description: "Filter node_types by category: flow, data, ai, integration, advanced",
      },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly ops: DashboardWorkflowOps;
  private readonly provider_ops: DashboardAgentProviderOps | null;
  private catalog_cache: string | null = null;

  constructor(ops: DashboardWorkflowOps, provider_ops?: DashboardAgentProviderOps | null) {
    super();
    this.ops = ops;
    this.provider_ops = provider_ops ?? null;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "");

    switch (action) {
      case "create": return this.handle_create(params);
      case "list": return this.handle_list();
      case "get": return this.handle_get(params);
      case "run": return this.handle_run(params, context);
      case "update": return this.handle_update(params);
      case "delete": return this.handle_delete(params);
      case "export": return this.handle_export(params);
      case "flowchart": return this.handle_diagram(params, "flowchart");
      case "sequence": return this.handle_diagram(params, "sequence");
      case "node_types": return this.handle_node_types(params);
      case "models": return this.handle_models();
      default: return `Error: unsupported action '${action}'. Use: create, list, get, run, update, delete, export, flowchart, sequence, node_types, models`;
    }
  }

  private handle_create(params: Record<string, unknown>): string {
    const name = String(params.name || "");
    if (!name) return "Error: name is required for create";

    const raw = params.definition;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "Error: definition object is required for create";
    }

    // 기존 인프라의 normalize로 검증 + 정규화
    const def = normalize_workflow_definition(raw as Record<string, unknown>);
    if (!def) return "Error: invalid definition — title and phases[] with at least one phase (phase_id + agents[]) are required";

    try {
      const slug = this.ops.save_template(name, def);
      return JSON.stringify({ ok: true, slug, action: "created" });
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  }

  private handle_update(params: Record<string, unknown>): string {
    const name = String(params.name || "");
    if (!name) return "Error: name is required for update";

    // 존재 여부 확인
    const existing = this.ops.get_template(name);
    if (!existing) return `Error: template '${name}' not found — use 'create' for new templates`;

    const raw = params.definition;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "Error: definition object is required for update";
    }

    const def = normalize_workflow_definition(raw as Record<string, unknown>);
    if (!def) return "Error: invalid definition — title and phases[] with at least one phase (phase_id + agents[]) are required";

    try {
      const slug = this.ops.save_template(name, def);
      return JSON.stringify({ ok: true, slug, action: "updated" });
    } catch (e) {
      return `Error: ${String(e)}`;
    }
  }

  private handle_list(): string {
    const templates = this.ops.list_templates();
    const summary = templates.map((t) => ({
      title: t.title,
      slug: (t as { slug?: string }).slug || slugify(t.title),
      aliases: (t as { aliases?: string[] }).aliases || [],
      phases: t.phases?.length ?? 0,
      orche_nodes: t.orche_nodes?.length ?? 0,
      trigger_nodes: t.trigger_nodes ?? null,
    }));
    return JSON.stringify(summary);
  }

  private handle_get(params: Record<string, unknown>): string {
    const name = String(params.name || "");
    if (!name) return "Error: name is required";

    const template = this.ops.get_template(name);
    if (!template) return `Error: template '${name}' not found`;
    return JSON.stringify(template);
  }

  private async handle_run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const name = String(params.name || "");
    const channel = context?.channel || "dashboard";
    const chat_id = context?.chat_id || "web";

    if (name) {
      // 템플릿 존재 여부 사전 확인
      const template = this.ops.get_template(name);
      if (!template) return `Error: template '${name}' not found. Use 'list' to see available templates.`;

      const result = await this.ops.create({
        template_name: name,
        title: template.title,
        objective: template.objective || "",
        channel,
        chat_id,
        ...(params.variables ? { variables: params.variables } : {}),
      });
      return JSON.stringify(result);
    }

    // 인라인 definition으로 직접 실행
    const raw = params.definition;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "Error: name or definition is required for run";
    }

    // definition 전체를 ops.create에 전달 (phases, orche_nodes, field_mappings 등 모두 포함)
    const def = raw as Record<string, unknown>;
    const result = await this.ops.create({
      title: String(def.title || "Inline Workflow"),
      objective: String(def.objective || ""),
      channel,
      chat_id,
      phases: def.phases,
      nodes: def.nodes,
      orche_nodes: def.orche_nodes,
      field_mappings: def.field_mappings,
      hitl_channel: def.hitl_channel,
      variables: def.variables,
    });
    return JSON.stringify(result);
  }

  private handle_delete(params: Record<string, unknown>): string {
    const name = String(params.name || "");
    if (!name) return "Error: name is required for delete";

    const removed = this.ops.delete_template(name);
    return JSON.stringify({ ok: removed, action: "deleted", name });
  }

  private handle_export(params: Record<string, unknown>): string {
    const name = String(params.name || "");
    if (!name) return "Error: name is required for export";

    const yaml = this.ops.export_template(name);
    if (!yaml) return `Error: template '${name}' not found`;
    return yaml;
  }

  private handle_diagram(params: Record<string, unknown>, format: "flowchart" | "sequence"): string {
    const name = String(params.name || "");
    if (!name) return "Error: name is required";

    const template = this.ops.get_template(name);
    if (!template) return `Error: template '${name}' not found`;

    return format === "flowchart" ? workflow_to_flowchart(template) : workflow_to_sequence(template);
  }

  /** 사용 가능한 backends(프로바이더)와 각 프로바이더의 모델 목록을 반환. */
  private async handle_models(): Promise<string> {
    if (!this.provider_ops) return JSON.stringify({ error: "provider_ops_unavailable", backends: [] });

    const providers = await this.provider_ops.list();
    const enabled = providers.filter((p) => p.enabled);

    const results: Array<{
      backend: string;
      label: string;
      provider_type: string;
      available: boolean;
      models: Array<{ id: string; name: string; purpose: string }>;
    }> = [];

    for (const p of enabled) {
      let models: Array<{ id: string; name: string; purpose: string }> = [];
      try {
        // connection의 api_base를 우선 사용, 없으면 인스턴스 settings의 api_base
        let api_base = typeof p.settings?.api_base === "string" ? p.settings.api_base : undefined;
        if (p.connection_id) {
          const conn = await this.provider_ops.get_connection(p.connection_id);
          if (conn?.api_base) api_base = conn.api_base;
        }
        const raw = await this.provider_ops.list_models(p.provider_type, { api_base });
        models = raw.map((m) => ({ id: m.id, name: m.name, purpose: m.purpose }));
      } catch { /* skip if model fetch fails */ }
      results.push({
        backend: p.instance_id,
        label: p.label,
        provider_type: p.provider_type,
        available: p.available,
        models,
      });
    }

    return JSON.stringify({ backends: results });
  }

  /** 노드 카탈로그 반환. 카테고리 지정 시 필터링된 카탈로그 생성. */
  private handle_node_types(params: Record<string, unknown>): string {
    const cats = Array.isArray(params.node_categories) ? params.node_categories.filter((c): c is string => typeof c === "string") : undefined;
    if (cats?.length) {
      register_all_nodes();
      const { handlers } = select_nodes_for_request(get_all_handlers(), cats);
      return build_node_catalog(handlers);
    }
    if (!this.catalog_cache) {
      this.catalog_cache = build_node_catalog();
    }
    return this.catalog_cache;
  }
}
