/** Archive 도구 — tar/zip 생성 및 해제. */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class ArchiveTool extends Tool {
  readonly name = "archive";
  readonly category = "filesystem" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Create or extract tar/zip archives.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["create", "extract", "list"], description: "Archive operation" },
      format: { type: "string", enum: ["tar.gz", "zip"], description: "Archive format (default: tar.gz)" },
      archive_path: { type: "string", description: "Path to the archive file" },
      files: { type: "string", description: "Space-separated list of files/dirs to include (for create)" },
      output_dir: { type: "string", description: "Output directory for extraction" },
    },
    required: ["operation", "archive_path"],
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options?: { workspace?: string }) {
    super();
    this.workspace = options?.workspace || process.cwd();
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "list");
    const format = String(params.format || "tar.gz");
    const archive = String(params.archive_path || "");
    const files = String(params.files || "").trim();
    const output_dir = String(params.output_dir || ".").trim();

    if (!archive) return "Error: archive_path is required";
    if (context?.signal?.aborted) return "Error: cancelled";

    const command = this.build_command(op, format, archive, files, output_dir);
    if (!command) return `Error: unsupported operation/format "${op}/${format}"`;

    try {
      const { stdout, stderr } = await run_shell_command(command, {
        cwd: this.workspace,
        timeout_ms: 120_000,
        max_buffer_bytes: 1024 * 1024 * 4,
        signal: context?.signal,
      });
      const output = [stdout || "", stderr ? `STDERR:\n${stderr}` : ""].filter(Boolean).join("\n").trim();
      return output || `${op} completed: ${archive}`;
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private build_command(op: string, format: string, archive: string, files: string, output_dir: string): string | null {
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
}
