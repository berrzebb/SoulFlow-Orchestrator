/**
 * Archive 도구 — tar/zip 생성 및 해제.
 * shell 문자열 보간 대신 argv 배열로 실행하여 shell injection을 차단한다.
 */

import { Tool } from "./base.js";
import { run_command_argv } from "./shell-runtime.js";
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
      files: {
        type: "array",
        items: { type: "string" },
        description: "Files/dirs to include (for create). Each entry is validated individually.",
      },
      output_dir: { type: "string", description: "Output directory for extraction" },
    },
    required: ["operation", "archive_path"],
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options: { workspace: string }) {
    super();
    this.workspace = options.workspace;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "list");
    const format = String(params.format || "tar.gz");
    const archive = String(params.archive_path || "");
    const files_raw = params.files;
    const files = Array.isArray(files_raw)
      ? (files_raw as unknown[]).map(String).filter(Boolean)
      : [];
    const output_dir = String(params.output_dir || ".").trim();

    if (!archive) return "Error: archive_path is required";
    if (context?.signal?.aborted) return "Error: cancelled";

    const argv = this.build_argv(op, format, archive, files, output_dir);
    if (!argv) return `Error: unsupported operation/format "${op}/${format}"`;

    try {
      const [cmd, ...args] = argv;
      const { stdout, stderr } = await run_command_argv(cmd, args, {
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

  /** shell 없이 실행할 argv 배열을 반환. null이면 지원하지 않는 조합. */
  private build_argv(op: string, format: string, archive: string, files: string[], output_dir: string): string[] | null {
    if (format === "tar.gz") {
      switch (op) {
        case "create":  return files.length > 0 ? ["tar", "czf", archive, ...files] : null;
        case "extract": return ["tar", "xzf", archive, "-C", output_dir];
        case "list":    return ["tar", "tzf", archive];
        default: return null;
      }
    }
    if (format === "zip") {
      switch (op) {
        case "create":  return files.length > 0 ? ["zip", "-r", archive, ...files] : null;
        case "extract": return ["unzip", "-o", archive, "-d", output_dir];
        case "list":    return ["unzip", "-l", archive];
        default: return null;
      }
    }
    return null;
  }
}
