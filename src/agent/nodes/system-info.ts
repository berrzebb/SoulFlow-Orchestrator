/** System Info 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { SystemInfoNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

const CATEGORY_CMDS: Record<string, string> = {
  os:      "uname -a 2>/dev/null || cat /etc/os-release 2>/dev/null",
  uptime:  "uptime",
  cpu:     "nproc 2>/dev/null && cat /proc/cpuinfo 2>/dev/null | head -30",
  memory:  "free -h 2>/dev/null || vm_stat 2>/dev/null",
  disk:    "df -h 2>/dev/null | head -20",
  network: "ip addr show 2>/dev/null | head -30 || ifconfig 2>/dev/null | head -30",
};

export const system_info_handler: NodeHandler = {
  node_type: "system_info",
  icon: "\u{1F4BB}",
  color: "#546e7a",
  shape: "rect",
  output_schema: [
    { name: "info",    type: "object", description: "System info by category" },
    { name: "success", type: "boolean", description: "Whether collection succeeded" },
  ],
  input_schema: [
    { name: "category", type: "string", description: "disk / memory / cpu / os / uptime / network / all" },
  ],
  create_default: () => ({ category: "all" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SystemInfoNodeDefinition;
    const cat = n.category || "all";
    const categories = cat === "all" ? Object.keys(CATEGORY_CMDS) : [cat];
    const info: Record<string, string> = {};

    for (const key of categories) {
      const cmd = CATEGORY_CMDS[key];
      if (!cmd) continue;
      try {
        const { stdout } = await run_shell_command(cmd, {
          cwd: ctx.workspace,
          timeout_ms: 10_000,
          max_buffer_bytes: 1024 * 256,
          signal: ctx.abort_signal,
        });
        info[key] = (stdout || "").trim();
      } catch (err) {
        info[key] = `(error: ${error_message(err)})`;
      }
    }

    return { output: { info, success: true } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SystemInfoNodeDefinition;
    const warnings: string[] = [];
    const valid = ["disk", "memory", "cpu", "os", "uptime", "network", "all"];
    if (n.category && !valid.includes(n.category)) warnings.push(`unknown category: ${n.category}`);
    return { preview: { category: n.category || "all" }, warnings };
  },
};
