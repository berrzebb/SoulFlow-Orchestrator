import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConsolidationMessage,
  ConsolidationSession,
  LlmProviderLike,
  MemoryConsolidateOptions,
  MemoryConsolidateResult,
  MemoryKind,
} from "./memory.types.js";
import { file_exists, today_key } from "../utils/common.js";

const SAVE_MEMORY_TOOL = [
  {
    name: "save_memory",
    description: "Persist consolidated history and long-term memory update.",
    input_schema: {
      type: "object",
      properties: {
        history_entry: { type: "string", description: "Append-only history summary entry" },
        memory_update: { type: "string", description: "Full replacement content for MEMORY.md" },
      },
      required: [],
    },
  },
];

function is_daily_file(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(name);
}

export class MemoryStore {
  private readonly root: string;
  private readonly memoryDir: string;
  private readonly longtermPath: string;
  private readonly initialized: Promise<void>;

  constructor(workspaceRoot = process.cwd()) {
    this.root = workspaceRoot;
    this.memoryDir = join(this.root, "memory");
    this.longtermPath = join(this.memoryDir, "MEMORY.md");
    this.initialized = this.ensure_initialized();
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
    if (!(await file_exists(this.longtermPath))) await writeFile(this.longtermPath, "# MEMORY\n\n", "utf-8");
  }

  async get_paths(): Promise<{ workspace: string; memoryDir: string; longtermPath: string }> {
    await this.initialized;
    return { workspace: this.root, memoryDir: this.memoryDir, longtermPath: this.longtermPath };
  }

  async resolve_daily_path(day?: string): Promise<string> {
    await this.initialized;
    const key = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today_key();
    return join(this.memoryDir, `${key}.md`);
  }

  async list_daily(): Promise<string[]> {
    await this.initialized;
    return (await readdir(this.memoryDir))
      .filter(is_daily_file)
      .sort((a, b) => a.localeCompare(b));
  }

  async read_longterm(): Promise<string> {
    await this.initialized;
    return (await file_exists(this.longtermPath)) ? await readFile(this.longtermPath, "utf-8") : "";
  }

  async write_longterm(content: string): Promise<void> {
    await this.initialized;
    await writeFile(this.longtermPath, String(content || ""), "utf-8");
  }

  async append_longterm(content: string): Promise<void> {
    await this.initialized;
    await appendFile(this.longtermPath, String(content || ""), "utf-8");
  }

  async read_history(day?: string): Promise<string> {
    return this.read_daily(day);
  }

  async append_history(content: string, day?: string): Promise<void> {
    await this.append_daily(String(content || ""), day);
  }

  async read_daily(day?: string): Promise<string> {
    const p = await this.resolve_daily_path(day);
    return (await file_exists(p)) ? await readFile(p, "utf-8") : "";
  }

  async write_daily(content: string, day?: string): Promise<void> {
    const p = await this.resolve_daily_path(day);
    await writeFile(p, String(content || ""), "utf-8");
  }

  async append_daily(content: string, day?: string): Promise<void> {
    const p = await this.resolve_daily_path(day);
    if (!(await file_exists(p))) await writeFile(p, `# ${day || today_key()} Memory\n\n`, "utf-8");
    await appendFile(p, String(content || ""), "utf-8");
  }

  async save_memory(args: {
    kind: MemoryKind;
    content: string;
    mode?: "append" | "overwrite";
    day?: string;
  }): Promise<{ ok: boolean; target: string }> {
    const mode = args.mode || "append";
    if (args.kind === "longterm") {
      if (mode === "overwrite") await this.write_longterm(args.content);
      else await this.append_longterm(args.content);
      return { ok: true, target: this.longtermPath };
    }
    const p = await this.resolve_daily_path(args.day);
    if (mode === "overwrite") await this.write_daily(args.content, args.day);
    else await this.append_daily(args.content, args.day);
    return { ok: true, target: p };
  }

  async search(query: string, args?: { kind?: "all" | MemoryKind; day?: string; limit?: number; case_sensitive?: boolean }): Promise<Array<{ file: string; line: number; text: string }>> {
    const limit = Math.max(1, Number(args?.limit || 80));
    const cs = !!args?.case_sensitive;
    const needle = cs ? query : query.toLowerCase();
    const rows: Array<{ file: string; line: number; text: string }> = [];
    const targets: string[] = [];
    const kind = args?.kind || "all";
    if (kind === "all" || kind === "longterm") targets.push(this.longtermPath);
    if (kind === "all" || kind === "daily") {
      if (args?.day) targets.push(await this.resolve_daily_path(args.day));
      else for (const f of await this.list_daily()) targets.push(join(this.memoryDir, f));
    }
    for (const file of targets) {
      if (!(await file_exists(file))) continue;
      const lines = (await readFile(file, "utf-8")).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hay = cs ? line : line.toLowerCase();
        if (hay.includes(needle)) {
          rows.push({ file, line: i + 1, text: line });
          if (rows.length >= limit) return rows;
        }
      }
    }
    return rows;
  }

  async consolidate(options?: MemoryConsolidateOptions): Promise<MemoryConsolidateResult> {
    const windowDays = Math.max(1, Math.min(365, Number(options?.memory_window || 7)));
    const now = new Date();
    const files = await this.list_daily();
    const used: string[] = [];
    const archived: string[] = [];
    const chunks: string[] = [];
    for (const f of files) {
      const day = f.slice(0, 10);
      const d = new Date(`${day}T00:00:00Z`);
      if (!Number.isFinite(d.getTime())) continue;
      const age = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (age > windowDays) continue;
      const full = join(this.memoryDir, f);
      if (!(await file_exists(full)) || !(await stat(full)).isFile()) continue;
      const content = (await readFile(full, "utf-8")).trim();
      if (!content) continue;
      used.push(f);
      chunks.push(`## Daily ${day}\n${content}`);
    }

    const longtermRaw = (await this.read_longterm()).trim();
    const header = [
      `\n## Consolidated ${today_key()}`,
      `- session: ${options?.session || "n/a"}`,
      `- provider: ${options?.provider || "n/a"}`,
      `- model: ${options?.model || "n/a"}`,
      `- memory_window_days: ${windowDays}`,
      "",
    ].join("\n");
    const body = chunks.join("\n\n");
    const block = body ? `${header}${body}\n` : `${header}- no daily content in window\n`;
    await this.append_longterm(block);

    const compressedPrompt = [
      "# COMPRESSED MEMORY PROMPT",
      "",
      "## Longterm",
      longtermRaw || "(empty)",
      "",
      "## Recent Daily",
      body || "(no daily content in window)",
      "",
      "## Runtime Context",
      `session=${options?.session || "n/a"}`,
      `provider=${options?.provider || "n/a"}`,
      `model=${options?.model || "n/a"}`,
      `memory_window_days=${windowDays}`,
      "",
      "## Injection Rule",
      "- Use this prompt as the primary bootstrap context.",
      "- Prefer longterm decisions; use daily memory for latest execution details.",
    ].join("\n");

    if (options?.archive) {
      const archiveDir = join(this.memoryDir, "archive");
      await mkdir(archiveDir, { recursive: true });
      for (const f of used) {
        const src = join(this.memoryDir, f);
        const dst = join(archiveDir, f);
        if (await file_exists(src)) {
          await rename(src, dst);
          archived.push(dst);
        }
      }
    }

    return {
      ok: true,
      longterm_appended_chars: block.length,
      daily_files_used: used,
      archived_files: archived,
      summary: body ? `consolidated ${used.length} daily files` : "no daily files consolidated",
      compressed_prompt: compressedPrompt,
    };
  }

  async consolidate_with_provider(
    session: ConsolidationSession,
    provider: LlmProviderLike,
    model: string,
    options?: { archive_all?: boolean; memory_window?: number },
  ): Promise<boolean> {
    const archiveAll = !!options?.archive_all;
    const memoryWindow = Math.max(4, Number(options?.memory_window || 50));

    let oldMessages: ConsolidationMessage[] = [];
    let keepCount = 0;
    if (archiveAll) {
      oldMessages = session.messages;
      keepCount = 0;
    } else {
      keepCount = Math.floor(memoryWindow / 2);
      if (session.messages.length <= keepCount) return true;
      if (session.messages.length - Number(session.last_consolidated || 0) <= 0) return true;
      oldMessages = session.messages.slice(Number(session.last_consolidated || 0), Math.max(0, session.messages.length - keepCount));
      if (oldMessages.length === 0) return true;
    }

    const lines: string[] = [];
    for (const m of oldMessages) {
      if (!m?.content) continue;
      const tools = Array.isArray(m.tools_used) && m.tools_used.length > 0
        ? ` [tools: ${m.tools_used.join(", ")}]`
        : "";
      const ts = String(m.timestamp || "?").slice(0, 16);
      lines.push(`[${ts}] ${String(m.role || "unknown").toUpperCase()}${tools}: ${String(m.content)}`);
    }
    if (lines.length === 0) return true;

    const currentMemory = await this.read_longterm();
    const prompt = [
      "Process this conversation and call the save_memory tool with your consolidation.",
      "",
      "## Current Long-term Memory",
      currentMemory || "(empty)",
      "",
      "## Conversation to Process",
      lines.join("\n"),
    ].join("\n");

    const response = await provider.chat({
      messages: [
        {
          role: "system",
          content: "You are a memory consolidation agent. Call the save_memory tool with your consolidation of the conversation.",
        },
        { role: "user", content: prompt },
      ],
      tools: SAVE_MEMORY_TOOL,
      model,
    });

    if (!response?.has_tool_calls || !Array.isArray(response.tool_calls) || response.tool_calls.length === 0) {
      return false;
    }
    const args = response.tool_calls[0]?.arguments || {};

    const historyEntry = args.history_entry;
    if (historyEntry !== undefined && historyEntry !== null) {
      const text = typeof historyEntry === "string" ? historyEntry : JSON.stringify(historyEntry);
      if (text.trim()) await this.append_history(`${text}\n`);
    }

    const memoryUpdate = args.memory_update;
    if (memoryUpdate !== undefined && memoryUpdate !== null) {
      const text = typeof memoryUpdate === "string" ? memoryUpdate : JSON.stringify(memoryUpdate);
      if (text !== currentMemory) await this.write_longterm(text);
    }

    session.last_consolidated = archiveAll ? 0 : Math.max(0, session.messages.length - keepCount);
    return true;
  }
}
