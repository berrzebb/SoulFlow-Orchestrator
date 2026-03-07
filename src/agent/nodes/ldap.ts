/** LDAP 노드 핸들러 — 워크플로우에서 LDAP 디렉터리 조회. */

import type { NodeHandler } from "../node-registry.js";
import type { LdapNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const ldap_handler: NodeHandler = {
  node_type: "ldap",
  icon: "\u{1F4C2}",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "LDAP operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "bind / search / info" },
    { name: "host", type: "string", description: "LDAP server host" },
  ],
  create_default: () => ({ action: "search", host: "", port: 389, base_dn: "", filter: "(objectClass=*)" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as LdapNodeDefinition;
    try {
      const { LdapTool } = await import("../tools/ldap.js");
      const tool = new LdapTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "search",
        host: resolve_templates(n.host || "", tpl),
        port: n.port || 389,
        bind_dn: n.bind_dn ? resolve_templates(n.bind_dn, tpl) : undefined,
        password: n.password ? resolve_templates(n.password, tpl) : undefined,
        base_dn: n.base_dn ? resolve_templates(n.base_dn, tpl) : undefined,
        filter: n.filter ? resolve_templates(n.filter, tpl) : undefined,
        scope: n.scope,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { result: parsed, success: parsed.success !== false } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as LdapNodeDefinition;
    const warnings: string[] = [];
    if (!n.host) warnings.push("host is required");
    return { preview: { action: n.action, host: n.host, base_dn: n.base_dn }, warnings };
  },
};
