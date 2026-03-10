/** iCal 노드 핸들러 — iCalendar 이벤트 생성/파싱. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

interface IcalNodeDefinition extends OrcheNodeDefinition {
  action?: string;
  events?: string;
  event?: string;
  input?: string;
  calendar_name?: string;
}

export const ical_handler: NodeHandler = {
  node_type: "ical",
  icon: "\u{1F4C5}",
  color: "#00838f",
  shape: "rect",
  output_schema: [
    { name: "ics",    type: "string", description: "iCalendar (.ics) content" },
    { name: "events", type: "array",  description: "Parsed events" },
    { name: "valid",  type: "boolean", description: "Whether ICS is valid" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "generate/parse/add_event/validate" },
    { name: "events", type: "string", description: "JSON array of events" },
  ],
  create_default: () => ({ action: "generate", events: "", event: "", input: "", calendar_name: "Calendar" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as IcalNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { IcalTool } = await import("../tools/ical.js");
      const tool = new IcalTool();
      const raw = await tool.execute({
        action:        n.action || "generate",
        events:        resolve_templates(n.events || "", tpl) || undefined,
        event:         resolve_templates(n.event || "", tpl) || undefined,
        input:         resolve_templates(n.input || "", tpl) || undefined,
        calendar_name: n.calendar_name || undefined,
      });
      // generate/add_event는 raw ICS 문자열, parse/validate는 JSON
      const is_ics = raw.startsWith("BEGIN:VCALENDAR");
      if (is_ics) return { output: { ics: raw, valid: true } };
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as IcalNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "generate" && !n.events?.trim()) warnings.push("events is required for generate");
    if ((n.action === "parse" || n.action === "validate") && !n.input?.trim()) warnings.push("input (ICS content) is required");
    return { preview: { action: n.action, calendar_name: n.calendar_name }, warnings };
  },
};
