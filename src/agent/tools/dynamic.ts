import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

const exec_async = promisify(exec);

export type DynamicToolManifestEntry = {
  name: string;
  description: string;
  enabled: boolean;
  kind: "shell";
  parameters: JsonSchema;
  command_template: string;
  working_dir?: string;
  requires_approval?: boolean;
};

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const v = params[key];
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  });
}

export class DynamicShellTool extends Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  private readonly command_template: string;
  private readonly working_dir: string;
  private readonly requires_approval: boolean;

  constructor(entry: DynamicToolManifestEntry, default_working_dir: string) {
    super();
    this.name = entry.name;
    this.description = entry.description;
    this.parameters = entry.parameters;
    this.command_template = entry.command_template;
    this.working_dir = entry.working_dir || default_working_dir;
    this.requires_approval = entry.requires_approval === true;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    if (this.requires_approval && params.__approved !== true) {
      return [
        "Error: approval_required",
        "reason: dynamic tool marked as write-risk or external-risk",
        "action: Ask leader/user approval and re-run with __approved=true",
      ].join("\n");
    }
    if (context?.signal?.aborted) return "Error: aborted";
    const command = interpolate(this.command_template, params);
    const { stdout, stderr } = await exec_async(command, {
      cwd: this.working_dir,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const out = String(stdout || "").trim();
    const err = String(stderr || "").trim();
    if (err && !out) return `stderr:\n${err}`;
    if (err && out) return `${out}\n\nstderr:\n${err}`;
    return out || "ok";
  }
}
