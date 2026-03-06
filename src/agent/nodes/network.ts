/** Network 노드 핸들러 — 네트워크 진단. */

import type { NodeHandler } from "../node-registry.js";
import type { NetworkNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

export const network_handler: NodeHandler = {
  node_type: "network",
  icon: "\u{1F310}",
  color: "#00897b",
  shape: "rect",
  output_schema: [
    { name: "output",  type: "string",  description: "Command output" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "ping / dns / port_check / http_head / netstat" },
    { name: "host",      type: "string", description: "Target host" },
    { name: "port",      type: "number", description: "Port number" },
  ],
  create_default: () => ({ operation: "ping", host: "", port: 0, count: 3 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as NetworkNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = resolve_templates(n.operation || "ping", tpl);
    const host = resolve_templates(n.host || "", tpl).replace(/[;&|`$(){}]/g, "");
    const port = n.port || 0;
    const count = Math.max(1, Math.min(10, n.count || 3));

    const cmd = build_net_cmd(op, host, port, count);
    if (!cmd) return { output: { output: "", success: false, error: `unsupported: ${op}` } };

    try {
      const { stdout, stderr } = await run_shell_command(cmd, {
        cwd: process.cwd(),
        timeout_ms: 15_000,
        max_buffer_bytes: 1024 * 256,
        signal: ctx.abort_signal,
      });
      return { output: { output: [stdout || "", stderr || ""].join("\n").trim() || "(no output)", success: true } };
    } catch (err) {
      return { output: { output: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as NetworkNodeDefinition;
    const warnings: string[] = [];
    if (!n.operation) warnings.push("operation is required");
    if (["ping", "dns", "port_check", "http_head"].includes(n.operation || "") && !n.host) warnings.push("host is required");
    if (n.operation === "port_check" && !n.port) warnings.push("port is required");
    return { preview: { operation: n.operation, host: n.host, port: n.port }, warnings };
  },
};

function build_net_cmd(op: string, host: string, port: number, count: number): string | null {
  switch (op) {
    case "ping":       return host ? `ping -c ${count} -W 3 ${host}` : null;
    case "dns":        return host ? `dig +short ${host} A 2>/dev/null || nslookup ${host} 2>/dev/null` : null;
    case "port_check": return (host && port) ? `timeout 5 bash -c 'echo > /dev/tcp/${host}/${port}' 2>&1 && echo "OPEN" || echo "CLOSED/FILTERED"` : null;
    case "http_head":  return host ? `curl -sI -m 10 --max-redirs 3 "${host.startsWith("http") ? host : `https://${host}`}"` : null;
    case "netstat":    return "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null";
    default: return null;
  }
}
