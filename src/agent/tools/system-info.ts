/** System Info 도구 — 시스템 정보 수집 (disk, memory, cpu, os). */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class SystemInfoTool extends Tool {
  readonly name = "system_info";
  readonly category = "shell" as const;
  readonly description = "Collect system information: disk, memory, cpu, os, uptime, network interfaces.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["disk", "memory", "cpu", "os", "uptime", "network", "all"],
        description: "Information category (default: all)",
      },
    },
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options?: { workspace?: string }) {
    super();
    this.workspace = options?.workspace || process.cwd();
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const cat = String(params.category || "all");
    if (context?.signal?.aborted) return "Error: cancelled";

    const sections: Record<string, string> = {};
    const collect = async (key: string, cmd: string) => {
      try {
        const { stdout } = await run_shell_command(cmd, {
          cwd: this.workspace,
          timeout_ms: 10_000,
          max_buffer_bytes: 1024 * 256,
          signal: context?.signal,
        });
        sections[key] = (stdout || "").trim();
      } catch (err) {
        sections[key] = `(error: ${error_message(err)})`;
      }
    };

    if (cat === "all" || cat === "os")      await collect("os", "uname -a 2>/dev/null || cat /etc/os-release 2>/dev/null");
    if (cat === "all" || cat === "uptime")  await collect("uptime", "uptime");
    if (cat === "all" || cat === "cpu")     await collect("cpu", "nproc 2>/dev/null && cat /proc/cpuinfo 2>/dev/null | head -30 || sysctl -n machdep.cpu.brand_string 2>/dev/null");
    if (cat === "all" || cat === "memory")  await collect("memory", "free -h 2>/dev/null || vm_stat 2>/dev/null");
    if (cat === "all" || cat === "disk")    await collect("disk", "df -h 2>/dev/null | head -20");
    if (cat === "all" || cat === "network") await collect("network", "ip addr show 2>/dev/null | head -30 || ifconfig 2>/dev/null | head -30");

    const lines = Object.entries(sections).map(([k, v]) => `=== ${k.toUpperCase()} ===\n${v}`);
    return lines.join("\n\n");
  }
}
