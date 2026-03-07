/** Git 도구 — status, diff, log, commit, push 등 Git 작업 수행. */

import { Tool } from "./base.js";
import { run_shell_command } from "./shell-runtime.js";
import { error_message } from "../../utils/common.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

type GitOperation = "status" | "diff" | "log" | "commit" | "push" | "pull" | "branch" | "checkout" | "stash" | "tag";

export class GitTool extends Tool {
  readonly name = "git";
  readonly category = "shell" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Execute Git operations: status, diff, log, commit, push, pull, branch, checkout, stash, tag.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["status", "diff", "log", "commit", "push", "pull", "branch", "checkout", "stash", "tag"],
        description: "Git operation to perform",
      },
      args: { type: "string", description: "Additional arguments (e.g., branch name, commit message)" },
      working_dir: { type: "string", description: "Repository directory (defaults to workspace)" },
    },
    required: ["operation"],
    additionalProperties: false,
  };

  private readonly workspace: string;

  constructor(options: { workspace: string }) {
    super();
    this.workspace = options.workspace;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const op = String(params.operation || "status") as GitOperation;
    const args = String(params.args || "").trim();
    const cwd = String(params.working_dir || this.workspace);

    const command = this.build_command(op, args);
    if (!command) return `Error: unsupported operation "${op}"`;

    if (context?.signal?.aborted) return "Error: cancelled";
    try {
      const { stdout, stderr } = await run_shell_command(command, {
        cwd,
        timeout_ms: 30_000,
        max_buffer_bytes: 1024 * 1024 * 4,
        signal: context?.signal,
      });
      const output = [stdout || "", stderr ? `STDERR:\n${stderr}` : ""].filter(Boolean).join("\n").trim();
      const text = output || "(no output)";
      return text.length > 20_000 ? `${text.slice(0, 20_000)}\n... (truncated)` : text;
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }

  private build_command(op: GitOperation, args: string): string | null {
    switch (op) {
      case "status":   return `git status ${args}`.trim();
      case "diff":     return `git diff ${args}`.trim();
      case "log":      return `git log --oneline -20 ${args}`.trim();
      case "commit":   return args ? `git commit -m ${this.shell_quote(args)}` : null;
      case "push":     return `git push ${args}`.trim();
      case "pull":     return `git pull ${args}`.trim();
      case "branch":   return `git branch ${args}`.trim();
      case "checkout": return args ? `git checkout ${args}` : null;
      case "stash":    return `git stash ${args || "list"}`.trim();
      case "tag":      return `git tag ${args}`.trim();
      default: return null;
    }
  }

  private shell_quote(s: string): string {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
}
