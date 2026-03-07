import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { Tool } from "./base.js";
import type { JsonSchema, ToolCategory, ToolExecutionContext, ToolPolicyFlags } from "./types.js";

type FsToolOptions = {
  workspace: string;
  allowed_dir?: string | null;
};

function is_approved(params: Record<string, unknown>): boolean {
  return params.__approved === true || String(params.__approved || "").trim().toLowerCase() === "true";
}

function resolve_path(path: string, workspace: string): string {
  const base = workspace;
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
  workspace: string,
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
  readonly category: ToolCategory = "filesystem";
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

  constructor(options: FsToolOptions) {
    super();
    this.workspace = options.workspace;
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
  readonly category: ToolCategory = "filesystem";
  readonly policy_flags: ToolPolicyFlags = { write: true };
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

  constructor(options: FsToolOptions) {
    super();
    this.workspace = options.workspace;
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
  readonly category: ToolCategory = "filesystem";
  readonly policy_flags: ToolPolicyFlags = { write: true };
  readonly description = "Edit a file by replacing exact old_text with new_text. By default replaces single occurrence; set replace_all=true for global replace.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path of file to edit" },
      old_text: { type: "string", description: "Exact old text" },
      new_text: { type: "string", description: "Replacement text" },
      replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
    },
    required: ["path", "old_text", "new_text"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options: FsToolOptions) {
    super();
    this.workspace = options.workspace;
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const file_path = resolved.path;
    const old_text = String(params.old_text || "");
    const new_text = String(params.new_text || "");
    const replace_all = Boolean(params.replace_all);
    const content = await readFile(file_path, "utf-8");
    const count = old_text ? content.split(old_text).length - 1 : 0;
    if (count === 0) return "Error: old_text not found";
    if (!replace_all && count > 1) return `Error: old_text appears ${count} times; use replace_all=true or make it unique`;
    const updated = replace_all ? content.split(old_text).join(new_text) : content.replace(old_text, new_text);
    await writeFile(file_path, updated, "utf-8");
    return replace_all && count > 1 ? `Edited ${file_path} (${count} replacements)` : `Edited ${file_path}`;
  }
}

export class ListDirTool extends Tool {
  readonly name = "list_dir";
  readonly category: ToolCategory = "filesystem";
  readonly description = "List entries in a directory. Supports recursive traversal and glob-style pattern filtering.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path" },
      recursive: { type: "boolean", description: "Recurse into subdirectories (default false)" },
      max_depth: { type: "integer", minimum: 1, maximum: 10, description: "Max recursion depth (default 3, only with recursive=true)" },
      pattern: { type: "string", description: "Glob-style filter pattern (e.g. '*.ts', '*.json'). Matches file/dir name." },
      limit: { type: "integer", minimum: 1, maximum: 2000, description: "Max entries to return (default 200)" },
    },
    required: ["path"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options: FsToolOptions) {
    super();
    this.workspace = options.workspace;
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const dir_path = resolved.path;
    const dir_stat = await stat(dir_path);
    if (!dir_stat.isDirectory()) return `Error: Not a directory: ${dir_path}`;
    const limit = Math.max(1, Math.min(2000, Number(params.limit || 200)));
    const recursive = Boolean(params.recursive);
    const max_depth = Math.max(1, Math.min(10, Number(params.max_depth || 3)));
    const pattern = String(params.pattern || "").trim();
    const matcher = pattern ? glob_to_regex(pattern) : null;

    const lines: string[] = [];
    await collect_entries(dir_path, dir_path, recursive ? max_depth : 0, matcher, lines, limit);
    if (lines.length === 0) return "(empty directory)";
    return lines.join("\n");
  }
}

function glob_to_regex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

async function collect_entries(
  base_dir: string,
  current_dir: string,
  depth: number,
  matcher: RegExp | null,
  out: string[],
  limit: number,
): Promise<void> {
  if (out.length >= limit) return;
  const entries = await readdir(current_dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= limit) return;
    const matches = !matcher || matcher.test(entry.name);
    const rel = relative(base_dir, join(current_dir, entry.name));
    if (matches) {
      out.push(`${entry.isDirectory() ? "dir" : "file"}\t${rel}`);
    }
    if (entry.isDirectory() && depth > 0) {
      await collect_entries(base_dir, join(current_dir, entry.name), depth - 1, matcher, out, limit);
    }
  }
}

export class SearchFilesTool extends Tool {
  readonly name = "search_files";
  readonly category: ToolCategory = "filesystem";
  readonly description = "Search for files by name pattern and optionally grep content. Returns matching file paths with optional content matches.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to search in" },
      pattern: { type: "string", description: "Glob pattern for file names (e.g. '*.ts', '*.json')" },
      content: { type: "string", description: "Text to search for inside matched files (case-insensitive)" },
      max_depth: { type: "integer", minimum: 1, maximum: 20, description: "Max recursion depth (default 10)" },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Max results (default 50)" },
    },
    required: ["path"],
    additionalProperties: false,
  };
  private readonly workspace: string;
  private readonly allowed_dir: string | null;

  constructor(options: FsToolOptions) {
    super();
    this.workspace = options.workspace;
    this.allowed_dir = options?.allowed_dir ?? null;
  }

  protected async run(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const original_path = String(params.path || "");
    const resolved = resolve_path_with_approval(original_path, params, this.workspace, this.allowed_dir);
    if (!resolved.path) return resolved.error || "Error: invalid_path";
    const dir_path = resolved.path;
    const dir_stat = await stat(dir_path);
    if (!dir_stat.isDirectory()) return `Error: Not a directory: ${dir_path}`;

    const pattern = String(params.pattern || "").trim();
    const content_query = String(params.content || "").trim();
    const max_depth = Math.max(1, Math.min(20, Number(params.max_depth || 10)));
    const limit = Math.max(1, Math.min(200, Number(params.limit || 50)));
    const matcher = pattern ? glob_to_regex(pattern) : null;

    const file_paths: string[] = [];
    await find_files(dir_path, dir_path, max_depth, matcher, file_paths, limit * 10);

    if (!content_query) {
      const results = file_paths.slice(0, limit);
      return results.length === 0
        ? "No files found"
        : results.map((f) => relative(dir_path, f)).join("\n");
    }

    const query_lower = content_query.toLowerCase();
    const results: string[] = [];
    for (const file_path of file_paths) {
      if (results.length >= limit) break;
      try {
        const text = await readFile(file_path, "utf-8");
        const lines = text.split(/\r?\n/);
        const matches: string[] = [];
        for (let i = 0; i < lines.length && matches.length < 3; i++) {
          if (lines[i].toLowerCase().includes(query_lower)) {
            matches.push(`  L${i + 1}: ${lines[i].slice(0, 200)}`);
          }
        }
        if (matches.length > 0) {
          results.push(`${relative(dir_path, file_path)}\n${matches.join("\n")}`);
        }
      } catch { /* skip binary/unreadable */ }
    }

    return results.length === 0
      ? `No files containing "${content_query}"`
      : results.join("\n\n");
  }
}

async function find_files(
  base_dir: string,
  current_dir: string,
  depth: number,
  matcher: RegExp | null,
  out: string[],
  max: number,
): Promise<void> {
  if (out.length >= max || depth < 0) return;
  const entries = await readdir(current_dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= max) return;
    const full = join(current_dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await find_files(base_dir, full, depth - 1, matcher, out, max);
    } else if (!matcher || matcher.test(entry.name)) {
      out.push(full);
    }
  }
}
