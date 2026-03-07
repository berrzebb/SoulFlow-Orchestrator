/** Archive 노드 핸들러 — 워크플로우에서 tar/zip 조작. */

import type { NodeHandler } from "../node-registry.js";
import type { ArchiveNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { run_shell_command } from "../tools/shell-runtime.js";
import { error_message } from "../../utils/common.js";

export const archive_handler: NodeHandler = {
  node_type: "archive",
  icon: "\u{1F4E6}",
  color: "#795548",
  shape: "rect",
  output_schema: [
    { name: "output",   type: "string", description: "Command output or file list" },
    { name: "success",  type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation",    type: "string", description: "create / extract / list" },
    { name: "archive_path", type: "string", description: "Archive file path" },
    { name: "files",        type: "string", description: "Files to include" },
  ],
  create_default: () => ({ operation: "list", format: "tar.gz", archive_path: "", files: "", output_dir: "." }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ArchiveNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = resolve_templates(n.operation || "list", tpl);
    const format = n.format || "tar.gz";
    const archive = resolve_templates(n.archive_path || "", tpl);
    const files = resolve_templates(n.files || "", tpl).trim();
    const output_dir = resolve_templates(n.output_dir || ".", tpl);

    if (!archive) return { output: { output: "", success: false, error: "archive_path is required" } };

    const command = build_archive_command(op, format, archive, files, output_dir);
    if (!command) return { output: { output: "", success: false, error: `unsupported: ${op}/${format}` } };

    try {
      const { stdout, stderr } = await run_shell_command(command, {
        cwd: ctx.workspace,
        timeout_ms: 120_000,
        max_buffer_bytes: 1024 * 1024 * 4,
        signal: ctx.abort_signal,
      });
      const out = [stdout || "", stderr || ""].join("\n").trim();
      return { output: { output: out || `${op} completed`, success: true } };
    } catch (err) {
      return { output: { output: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ArchiveNodeDefinition;
    const warnings: string[] = [];
    if (!n.archive_path?.trim()) warnings.push("archive_path is required");
    if (n.operation === "create" && !n.files?.trim()) warnings.push("files are required for create");
    return { preview: { operation: n.operation, format: n.format, archive_path: n.archive_path }, warnings };
  },
};

function build_archive_command(op: string, format: string, archive: string, files: string, output_dir: string): string | null {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  if (format === "tar.gz") {
    switch (op) {
      case "create":  return files ? `tar czf ${q(archive)} ${files}` : null;
      case "extract": return `tar xzf ${q(archive)} -C ${q(output_dir)}`;
      case "list":    return `tar tzf ${q(archive)}`;
      default: return null;
    }
  }
  if (format === "zip") {
    switch (op) {
      case "create":  return files ? `zip -r ${q(archive)} ${files}` : null;
      case "extract": return `unzip -o ${q(archive)} -d ${q(output_dir)}`;
      case "list":    return `unzip -l ${q(archive)}`;
      default: return null;
    }
  }
  return null;
}
