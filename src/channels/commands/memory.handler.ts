import {
  parse_memory_quick_action,
  has_explicit_memory_intent,
  extract_memory_search_query,
  normalize_common_command_text,
} from "../command-intent.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

export interface MemoryStoreLike {
  search(query: string, opts: { limit: number }): Promise<Array<{ file: string; line: number; text: string }>>;
  read_daily(day: string): Promise<string | null>;
  read_longterm(): Promise<string | null>;
  list_daily(): Promise<string[]>;
}

export interface MemoryAccess {
  get_memory_store(): MemoryStoreLike | null;
}

function kst_today_key(now = Date.now()): string {
  const shifted = new Date(now + 9 * 3_600_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function format_usage(mention: string): string {
  return [
    `${mention}memory 명령 사용법`,
    "- /memory status | list | today | longterm | search <query>",
  ].join("\n");
}

export class MemoryHandler implements CommandHandler {
  readonly name = "memory";

  constructor(private readonly access: MemoryAccess) {}

  can_handle(ctx: CommandContext): boolean {
    const normalized = normalize_common_command_text(String(ctx.message.content || ""));
    const action = parse_memory_quick_action(normalized, ctx.command);
    return !!action || has_explicit_memory_intent(normalized);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const { provider, message, command } = ctx;
    const normalized = normalize_common_command_text(String(message.content || ""));
    const action = parse_memory_quick_action(normalized, command) || "status";
    const memory = this.access.get_memory_store();
    const mention = format_mention(provider, message.sender_id);

    if (!memory) {
      await ctx.send_reply("memory service unavailable");
      return true;
    }

    switch (action) {
      case "search": {
        const query = extract_memory_search_query(normalized, command);
        if (!query) { await ctx.send_reply(format_usage(mention)); return true; }
        const rows = await memory.search(query, { limit: 10 });
        await ctx.send_reply(
          rows.length <= 0
            ? `${mention}메모리 검색 결과가 없습니다. query='${query}'`
            : [
                `${mention}메모리 검색 결과 (${Math.min(rows.length, 10)})`,
                ...rows.slice(0, 10).map((row, i) => `${i + 1}. ${row.file}:${row.line} ${String(row.text || "").slice(0, 120)}`),
              ].join("\n"),
        );
        return true;
      }
      case "today": {
        const day = kst_today_key();
        const body = String(await memory.read_daily(day) || "").trim();
        await ctx.send_reply(
          body
            ? `${mention}오늘 메모리(${day})\n${body.slice(0, 1400)}`
            : `${mention}오늘 메모리(${day})는 비어 있습니다.`,
        );
        return true;
      }
      case "longterm": {
        const body = String(await memory.read_longterm() || "").trim();
        await ctx.send_reply(
          body
            ? `${mention}장기 메모리\n${body.slice(0, 1400)}`
            : `${mention}장기 메모리가 비어 있습니다.`,
        );
        return true;
      }
      case "list": {
        const files = await memory.list_daily();
        const rows = [...files].slice(-20).reverse();
        await ctx.send_reply(
          rows.length <= 0
            ? `${mention}등록된 daily memory가 없습니다.`
            : `${mention}daily memory 목록 (${files.length})\n${rows.map((v, i) => `${i + 1}. ${v}`).join("\n")}`,
        );
        return true;
      }
      default: {
        const files = await memory.list_daily();
        const longterm = await memory.read_longterm();
        const today = kst_today_key();
        const today_body = String(await memory.read_daily(today) || "");
        const today_lines = today_body.split(/\r?\n/).map((v) => v.trim()).filter(Boolean).length;
        const recent = [...files].slice(-3).reverse().join(", ") || "(none)";
        await ctx.send_reply([
          `${mention}메모리 상태`,
          `- daily_files: ${files.length}`,
          `- recent_daily: ${recent}`,
          `- today_key: ${today}`,
          `- today_entries: ${today_lines}`,
          `- longterm_chars: ${String(longterm || "").length}`,
        ].join("\n"));
        return true;
      }
    }
  }
}
