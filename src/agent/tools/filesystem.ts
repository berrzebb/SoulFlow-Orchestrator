import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

type FsToolOptions = {
  workspace?: string;
  allowed_dir?: string | null;
};

function is_approved(params: Record<string, unknown>): boolean {
  return params.__approved === true || String(params.__approved || "").trim().toLowerCase() === "true";
}

function resolve_path(path: string, workspace?: string): string {
  const base = workspace || process.cwd();
  const raw = isAbsolute(path) ? path : join(base, path);
  return resolve(raw);
}

function is_outside_allowed_dir(resolved_path: string, allowed_dir?: string | null): boolean {
  if (!allowed_dir) return false;
  const guard = resolve(allowed_dir);
  const normalized = resolved_path.toLowerCase();
  const guardNorm = guard.toLowerCase();
  return normalized !== guardNorm
    && !normalized.startsWith(`${guardNorm}\\`)
    && !normalized.startsWith(`${guardNorm}/`);
}

function approval_required_for_path(original_path: string, resolved_path: string): string {
  return [
    "Error: approval_required",
    "reason: path_outside_allowed_dir",
    `requested_path: ${resolved_path}`,
    "action: Ask leader/user approval and re-run with __approved=true",
    `path: ${original_path}`,
  ].join("\n");
}

function resolve_path_with_approval(
  original_path: string,
  params: Record<string, unknown>,
  workspace?: string,
  allowed_dir?: string | null,
): { path: string | null; error?: string } {
  const resolved_path = resolve_path(original_path, workspace);
  if (!is_outside_allowed_dir(resolved_path, allowed_dir)) {
    return { path: resolved_path };
  }
  if (is_approved(params)) {
    return { path: resolved_path };
  }
  return {
    path: null,
    error: approval_required_for_path(original_path, resolved_path),
  };
}

export class ReadFileTool extends Tool {
  readonly name = "read_file";
  readonly description = "Read UTF-8 content from a file path.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of file to read" },
    },
    required: ["path"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options?: FsToolOptions) {
    super();
    this.workspace = options?.workspace || process.cwd();
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const file_path = resolved.path;
    const file_stat = await stat(file_path);
    if (!file_stat.isFile()) return `Error: Not a file: ${file_path}`;
    return readFile(file_path, "utf-8");
  }
}

export class WriteFileTool extends Tool {
  readonly name = "write_file";
  readonly description = "Write UTF-8 content to a file. Creates directories if needed.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of file to write" },
      content: { type: "string", description: "Content to write" },
      append: { type: "boolean", description: "Append mode; default false" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options?: FsToolOptions) {
    super();
    this.workspace = options?.workspace || process.cwd();
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const file_path = resolved.path;
    await mkdir(dirname(file_path), { recursive: true });
    const content = String(params.content || "");
    const append = Boolean(params.append);
    if (append) {
      const previous = await readFile(file_path, "utf-8").catch(() => "");
      await writeFile(file_path, `${previous}${content}`, "utf-8");
    } else {
      await writeFile(file_path, content, "utf-8");
    }
    return `Wrote ${content.length} chars to ${file_path}`;
  }
}

export class EditFileTool extends Tool {
  readonly name = "edit_file";
  readonly description = "Edit a file by replacing an exact old_text with new_text (single occurrence).";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of file to edit" },
      old_text: { type: "string", description: "Exact old text" },
      new_text: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_text", "new_text"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options?: FsToolOptions) {
    super();
    this.workspace = options?.workspace || process.cwd();
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const file_path = resolved.path;
    const old_text = String(params.old_text || "");
    const new_text = String(params.new_text || "");
    const content = await readFile(file_path, "utf-8");
    const count = old_text ? content.split(old_text).length - 1 : 0;
    if (count === 0) return "Error: old_text not found";
    if (count > 1) return `Error: old_text appears ${count} times; make it unique`;
    const updated = content.replace(old_text, new_text);
    await writeFile(file_path, updated, "utf-8");
    return `Edited ${file_path}`;
  }
}

export class ListDirTool extends Tool {
  readonly name = "list_dir";
  readonly description = "List entries in a directory.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path" },
      limit: { type: "integer", minimum: 1, maximum: 500, description: "Max entries to return" },
    },
    required: ["path"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options?: FsToolOptions) {
    super();
    this.workspace = options?.workspace || process.cwd();
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const dir_path = resolved.path;
    const dir_stat = await stat(dir_path);
    if (!dir_stat.isDirectory()) return `Error: Not a directory: ${dir_path}`;
    const entries = await readdir(dir_path, { withFileTypes: true });
    const limit = Math.max(1, Math.min(500, Number(params.limit || 200)));
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`);
    if (lines.length === 0) return "(empty directory)";
    return lines.join("\n");
  }
}
