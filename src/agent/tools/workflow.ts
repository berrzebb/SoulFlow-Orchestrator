/**
 * WorkflowTool — 에이전트가 워크플로우를 CRUD + 실행할 수 있는 도구.
 * 자연어 → DAG 변환은 에이전트(LLM)가 담당, 이 도구는 구조화된 정의를 저장/실행.
 */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import type { DashboardWorkflowOps } from "../../dashboard/service.js";
import { normalize_workflow_definition, slugify } from "../../orchestration/workflow-loader.js";
import { build_node_catalog } from "./workflow-catalog.js";

export class WorkflowTool extends Tool {
  readonly name = "workflow";
  readonly description =
    "Create, list, run, get, update, delete workflow templates.\n" +
    "Use 'create' with a structured definition (title + phases/orche_nodes) to build a new workflow.\n" +
    "Use 'run' with a template name to execute, or with an inline definition.\n" +
    "Use 'node_types' to discover available workflow node types and their schemas.";

  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "list", "get", "run", "update", "delete", "export", "node_types"],
        description: "Action to perform (node_types: show available node type catalog)",
      },
      name: { type: "string", description: "Workflow template name or slug" },
      definition: {
        type: "object",
        description: "WorkflowDefinition object (for create/update/run-inline). Must include title and phases array.",
      },
      variables: {
        type: "object",
        description: "Variable overrides when running a workflow (for run action)",
      },
    },
    required: ["action"],
    additionalProperties: false,
  };

  private readonly ops: DashboardWorkflowOps;
  private catalog_cache: string | null = null;

  constructor(ops: DashboardWorkflowOps) {
    super();
    this.ops = ops;
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
      case "node_types": return this.handle_node_types();
      default: return `Error: unsupported action '${action}'. Use: create, list, get, run, update, delete, export, node_types`;
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
      slug: slugify(t.title),
      phases: t.phases?.length ?? 0,
      orche_nodes: t.orche_nodes?.length ?? 0,
      trigger: t.trigger ?? null,
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

  /** 노드 카탈로그를 lazy 생성하여 반환. */
  private handle_node_types(): string {
    if (!this.catalog_cache) {
      this.catalog_cache = build_node_catalog();
    }
    return this.catalog_cache;
  }
}
