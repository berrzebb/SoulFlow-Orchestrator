/** vCard 노드 핸들러 — vCard 생성/파싱/검증. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type VcardNodeDef = OrcheNodeDefinition & {
  action?: string;
  name?: string;
  email?: string;
  phone?: string;
  org?: string;
  job_title?: string;
  url?: string;
  address?: string;
  note?: string;
  vcard?: string;
  data?: string;
  version?: string;
};

export const vcard_handler: NodeHandler = {
  node_type: "vcard",
  icon: "\u{1F4C7}",
  color: "#00695c",
  shape: "rect",
  output_schema: [
    { name: "result", type: "string",  description: "node.vcard.output.result" },
    { name: "valid",  type: "boolean", description: "node.vcard.output.valid" },
    { name: "errors", type: "array",   description: "node.vcard.output.errors" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.vcard.input.action" },
    { name: "name",   type: "string", description: "node.vcard.input.name" },
    { name: "vcard",  type: "string", description: "node.vcard.input.vcard" },
  ],
  create_default: () => ({
    action: "generate", name: "", email: "", phone: "", org: "",
    job_title: "", url: "", address: "", note: "", vcard: "", data: "", version: "4.0",
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as VcardNodeDef;
    const tpl = { memory: ctx.memory };
    const action = n.action || "generate";
    try {
      const { VcardTool } = await import("../tools/vcard.js");
      const tool = new VcardTool();
      const raw = await tool.execute({
        action,
        name:    resolve_templates(n.name    || "", tpl) || undefined,
        email:   resolve_templates(n.email   || "", tpl) || undefined,
        phone:   resolve_templates(n.phone   || "", tpl) || undefined,
        org:     resolve_templates(n.org     || "", tpl) || undefined,
        title:   resolve_templates(n.job_title || "", tpl) || undefined,
        url:     resolve_templates(n.url     || "", tpl) || undefined,
        address: resolve_templates(n.address || "", tpl) || undefined,
        note:    resolve_templates(n.note    || "", tpl) || undefined,
        vcard:   resolve_templates(n.vcard   || "", tpl) || undefined,
        data:    resolve_templates(n.data    || "", tpl) || undefined,
        version: n.version || "4.0",
      });
      // generate/from_json은 vCard 문자열 반환, 나머지는 JSON
      if (action === "generate" || action === "from_json") {
        return { output: { result: raw, valid: true, errors: [] } };
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: { result: raw, ...parsed } };
    } catch (err) {
      return { output: { result: "", valid: false, errors: [error_message(err)] } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as VcardNodeDef;
    const warnings: string[] = [];
    if (n.action === "generate" && !n.name) warnings.push("name is required for generate");
    if ((n.action === "parse" || n.action === "validate" || n.action === "to_json") && !n.vcard) warnings.push("vcard input is required");
    if (n.action === "from_json" && !n.data) warnings.push("data (JSON) is required for from_json");
    return { preview: { action: n.action }, warnings };
  },
};
