import { slash_name_in, slash_token_in } from "../slash-command.js";
import { normalize_common_command_text } from "../command-intent.js";
import type { InboundMessage } from "../../bus/types.js";
import type { ParsedSlashCommand } from "../slash-command.js";
import type { CronScheduler } from "../../cron/contracts.js";
import type { CronSchedule } from "../../cron/types.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

type CronQuickAction = "status" | "list" | "add" | "remove";

const ROOT_ALIASES = ["cron", "크론"] as const;
const STATUS_COMMAND_ALIASES = ["cron-status", "cron_status", "크론상태", "크론-상태"] as const;
const LIST_COMMAND_ALIASES = ["cron-list", "cron_list", "크론목록", "크론-목록"] as const;
const ADD_COMMAND_ALIASES = ["cron-add", "cron_add", "크론추가", "크론-추가"] as const;
const REMOVE_COMMAND_ALIASES = ["cron-remove", "cron_remove", "cron-delete", "cron_delete", "크론삭제", "크론-삭제"] as const;
const STATUS_ARG_ALIASES = ["status", "상태", "확인", "조회"] as const;
const LIST_ARG_ALIASES = ["jobs", "list", "목록", "리스트"] as const;
const ADD_ARG_ALIASES = ["add", "추가", "등록", "create"] as const;
const REMOVE_ARG_ALIASES = ["remove", "delete", "삭제", "제거"] as const;

function parse_action(message: InboundMessage, command: ParsedSlashCommand | null): CronQuickAction | null {
  const cmd = String(command?.name || "");
  const arg0 = String(command?.args_lower?.[0] || "");

  if (slash_name_in(cmd, ROOT_ALIASES)) {
    if (slash_token_in(arg0, LIST_ARG_ALIASES)) return "list";
    if (!arg0 || slash_token_in(arg0, STATUS_ARG_ALIASES)) return "status";
    if (slash_token_in(arg0, ADD_ARG_ALIASES)) return "add";
    if (slash_token_in(arg0, REMOVE_ARG_ALIASES)) return "remove";
  }
  if (slash_name_in(cmd, STATUS_COMMAND_ALIASES)) return "status";
  if (slash_name_in(cmd, LIST_COMMAND_ALIASES)) return "list";
  if (slash_name_in(cmd, ADD_COMMAND_ALIASES)) return "add";
  if (slash_name_in(cmd, REMOVE_COMMAND_ALIASES)) return "remove";

  const text = normalize_common_command_text(String(message.content || "")).toLowerCase();
  if (!text) return null;
  if (/^(?:cron|크론)(?:\s*작업)?\s*(?:status|상태|확인|조회)/.test(text)) return "status";
  if (/^(?:cron|크론)(?:\s*작업)?\s*(?:jobs|list|목록|리스트)/.test(text)) return "list";
  if (/^(?:cron|크론)(?:\s*작업)?\s*(?:add|추가|등록)\b/.test(text)) return "add";
  if (/^(?:cron|크론)(?:\s*작업)?\s*(?:remove|delete|삭제|제거)\b/.test(text)) return "remove";
  return null;
}

function has_cron_intent(message: InboundMessage): boolean {
  const text = normalize_common_command_text(String(message.content || "")).toLowerCase();
  if (!text || text.startsWith("/")) return false;
  return /(cron|크론|스케줄|예약|리마인드|remind|알림)/i.test(text);
}

function parse_duration_ms(token: string): number | null {
  const m = String(token || "").trim().match(/^(\d+)(s|sec|secs|second|seconds|초|m|min|mins|minute|minutes|분|h|hr|hrs|hour|hours|시간)?$/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = String(m[2] || "s").toLowerCase();
  const MINUTE_UNITS = new Set(["m", "min", "mins", "minute", "minutes", "분"]);
  const HOUR_UNITS = new Set(["h", "hr", "hrs", "hour", "hours", "시간"]);
  if (MINUTE_UNITS.has(unit)) return value * 60_000;
  if (HOUR_UNITS.has(unit)) return value * 3_600_000;
  return value * 1_000;
}

function has_natural_schedule_intent(body: string): boolean {
  return /(알림|리마인드|알려|깨워|예약|등록|실행|수행|전송|보내|notify|remind|run)/i.test(body);
}

type AddSpec = {
  schedule: CronSchedule;
  message: string;
  name: string;
  deliver: boolean;
  delete_after_run: boolean;
};

function parse_add_tokens(message: InboundMessage, command: ParsedSlashCommand | null): string[] {
  const cmd = String(command?.name || "");
  const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
  if (slash_name_in(cmd, ROOT_ALIASES) && args.length > 0 && slash_token_in(args[0], ADD_ARG_ALIASES)) return args.slice(1);
  if (slash_name_in(cmd, ADD_COMMAND_ALIASES)) return args;
  const text = normalize_common_command_text(String(message.content || ""));
  const m = text.match(/^(?:cron|크론)\s*(?:add|추가|등록)\s+(.+)$/i);
  if (!m) return [];
  return String(m[1] || "").split(/\s+/).filter(Boolean);
}

function parse_remove_job_id(message: InboundMessage, command: ParsedSlashCommand | null): string {
  const cmd = String(command?.name || "");
  const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
  if (slash_name_in(cmd, ROOT_ALIASES) && args.length >= 2 && slash_token_in(args[0], REMOVE_ARG_ALIASES)) return args[1];
  if (slash_name_in(cmd, REMOVE_COMMAND_ALIASES)) return args[0] || "";
  const text = normalize_common_command_text(String(message.content || ""));
  const m = text.match(/(?:cron|크론)\s*(?:remove|delete|삭제|제거)\s+([A-Za-z0-9_-]{4,64})\b/i);
  return m ? m[1] : "";
}

function parse_structured_add_spec(message: InboundMessage, command: ParsedSlashCommand | null): AddSpec | null {
  const tokens = parse_add_tokens(message, command);
  if (tokens.length < 3) return null;
  const mode = tokens[0].toLowerCase();
  let schedule: CronSchedule | null = null;
  let body_start = -1;

  if (mode === "every") {
    const every_ms = parse_duration_ms(tokens[1]);
    if (!every_ms) return null;
    schedule = { kind: "every", every_ms };
    body_start = 2;
  } else if (mode === "at") {
    const at_ms = Date.parse(tokens[1]);
    if (!Number.isFinite(at_ms) || at_ms <= 0) return null;
    schedule = { kind: "at", at_ms };
    body_start = 2;
  } else if (mode === "cron") {
    if (tokens.length < 7) return null;
    const expr = tokens.slice(1, 6).join(" ");
    let tz: string | null = null;
    let idx = 6;
    if (tokens[idx]?.toLowerCase() === "tz" && tokens[idx + 1]) {
      tz = tokens[idx + 1]; idx += 2;
    } else if (/^tz=/i.test(tokens[idx] || "")) {
      tz = tokens[idx].slice(3); idx += 1;
    }
    schedule = { kind: "cron", expr, tz: tz || null };
    body_start = idx;
  } else {
    return null;
  }

  const body = tokens.slice(body_start).join(" ").trim();
  if (!schedule || !body) return null;
  return {
    schedule,
    message: body,
    name: body.slice(0, 40),
    deliver: /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body),
    delete_after_run: schedule.kind === "at",
  };
}

function kst_date_parts(ms: number): { year: number; month: number; day: number } {
  const shifted = new Date(ms + 9 * 3_600_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function to_kst_epoch_ms(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  return Date.UTC(y, mo - 1, d, h - 9, mi, s, 0);
}

function parse_natural_add_spec(message: InboundMessage): AddSpec | null {
  const text = normalize_common_command_text(String(message.content || ""));
  if (!text || text.startsWith("/")) return null;

  const delayed_every = text.match(/^(\d+)\s*(초|분|시간|s|sec|secs|m|min|mins|h|hr|hrs)\s*(?:후|뒤)(?:에)?\s*(\d+)\s*(초|분|시간|s|sec|secs|m|min|mins|h|hr|hrs)\s*(?:간격(?:으로)?|마다)\s*(.+)$/i);
  if (delayed_every) {
    const start_delay = parse_duration_ms(`${delayed_every[1]}${delayed_every[2]}`);
    const every_ms = parse_duration_ms(`${delayed_every[3]}${delayed_every[4]}`);
    const body = String(delayed_every[5] || "").trim();
    if (!start_delay || !every_ms || !body || !has_natural_schedule_intent(body)) return null;
    return {
      schedule: { kind: "every", every_ms, at_ms: Date.now() + start_delay },
      message: body, name: body.slice(0, 40),
      deliver: /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body),
      delete_after_run: false,
    };
  }

  const rel = text.match(/^(\d+)\s*(초|분|시간|s|sec|secs|m|min|mins|h|hr|hrs)\s*(?:후|뒤)(?:에)?\s*(.+)$/i);
  if (rel) {
    const duration = parse_duration_ms(`${rel[1]}${rel[2]}`);
    const body = String(rel[3] || "").trim();
    if (!duration || !body || !has_natural_schedule_intent(body)) return null;
    return {
      schedule: { kind: "at", at_ms: Date.now() + duration },
      message: body, name: body.slice(0, 40),
      deliver: /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body),
      delete_after_run: true,
    };
  }

  const abs = text.match(/^(?:(오늘|내일|모레)\s+)?(?:(새벽|오전|오후|저녁|밤)\s*)?(\d{1,2})시(?:\s*(\d{1,2})분?)?(?:\s*(\d{1,2})초?)?\s*(?:에|쯤|부터)?\s+(.+)$/i);
  if (!abs) return null;
  const day_word = abs[1] || "";
  const meridiem = (abs[2] || "").toLowerCase();
  let hour = Number(abs[3] || 0);
  const minute = Number(abs[4] || 0);
  const second = Number(abs[5] || 0);
  const body = String(abs[6] || "").trim();
  if (!body || !has_natural_schedule_intent(body)) return null;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  if (meridiem === "오전" || meridiem === "새벽") { if (hour === 12) hour = 0; }
  else if (meridiem === "오후" || meridiem === "저녁" || meridiem === "밤") { if (hour >= 1 && hour <= 11) hour += 12; }
  if (hour === 24) hour = 0;
  if (hour < 0 || hour > 23) return null;

  const now = Date.now();
  const today = kst_date_parts(now);
  const day_offset = day_word === "내일" ? 1 : day_word === "모레" ? 2 : 0;
  let at_ms = to_kst_epoch_ms(today.year, today.month, today.day, hour, minute, second) + day_offset * 86_400_000;
  if (!day_word && at_ms <= now + 1_000) at_ms += 86_400_000;
  if (!Number.isFinite(at_ms) || at_ms <= now) return null;

  return {
    schedule: { kind: "at", at_ms },
    message: body, name: body.slice(0, 40),
    deliver: /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body),
    delete_after_run: true,
  };
}

function format_time_kr(ms: unknown): string {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return "n/a";
  return new Date(n).toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace(" ", "T") + "+09:00";
}

function render_schedule(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const s = raw as Record<string, unknown>;
  const kind = String(s.kind || "");
  if (kind === "every") {
    const sec = Math.max(1, Math.floor(Number(s.every_ms || 0) / 1000));
    const start = Number(s.at_ms || 0);
    return Number.isFinite(start) && start > 0 ? `every ${sec}s (start ${format_time_kr(start)})` : `every ${sec}s`;
  }
  if (kind === "at") return `at ${format_time_kr(s.at_ms)}`;
  if (kind === "cron") {
    const expr = String(s.expr || "").trim() || "(empty)";
    const tz = String(s.tz || "").trim();
    return tz ? `cron ${expr} tz=${tz}` : `cron ${expr}`;
  }
  return kind || "unknown";
}

export class CronHandler implements CommandHandler {
  readonly name = "cron";

  constructor(private readonly cron: CronScheduler | null) {}

  can_handle(ctx: CommandContext): boolean {
    if (!this.cron) return false;
    const action = parse_action(ctx.message, ctx.command);
    if (action) return true;
    if (parse_natural_add_spec(ctx.message)) return true;
    return has_cron_intent(ctx.message);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    if (!this.cron) return false;
    const { provider, message, command } = ctx;
    const action = parse_action(message, command);
    const natural_add = action ? null : parse_natural_add_spec(message);
    const mention = format_mention(provider, message.sender_id);

    try {
      if (action === "status") {
        const status = await this.cron.status();
        await ctx.send_reply([
          `${mention}cron 상태`,
          `- enabled: ${status.enabled ? "yes" : "no"}`,
          `- paused: ${status.paused ? "yes" : "no"}`,
          `- jobs: ${status.jobs}`,
          `- next_wake: ${format_time_kr(status.next_wake_at_ms)}`,
        ].join("\n"));
        return true;
      }

      if (action === "list") {
        const rows = await this.cron.list_jobs(true) as unknown as Array<Record<string, unknown>>;
        if (rows.length === 0) {
          await ctx.send_reply(`${mention}등록된 cron 작업이 없습니다.`);
        } else {
          const body = rows.slice(0, 10).map((row, i) => {
            const id = String(row.id || `job-${i + 1}`);
            const name = String(row.name || "(no-name)");
            const enabled = row.enabled === true ? "on" : "off";
            const state = (row.state && typeof row.state === "object") ? row.state as Record<string, unknown> : {};
            return `${i + 1}. ${id} | ${name} | ${enabled} | ${render_schedule(row.schedule)} | next=${format_time_kr(state.next_run_at_ms)}`;
          });
          const tail = rows.length > 10 ? [`... and ${rows.length - 10} more`] : [];
          await ctx.send_reply([`${mention}cron 작업 목록 (${rows.length})`, ...body, ...tail].join("\n"));
        }
        return true;
      }

      if (action === "remove") {
        const job_id = parse_remove_job_id(message, command);
        if (!job_id) {
          await ctx.send_reply(`${mention}cron remove 형식: /cron remove <job_id>`);
          return true;
        }
        const removed = await this.cron.remove_job(job_id);
        await ctx.send_reply(
          removed
            ? `${mention}cron 작업 삭제 완료: ${job_id}`
            : `${mention}cron 작업을 찾지 못했습니다: ${job_id}`,
        );
        return true;
      }

      // add (structured or natural)
      const spec = natural_add || parse_structured_add_spec(message, command);
      if (!spec) {
        await ctx.send_reply([
          `${mention}cron add 형식`,
          "- /cron add every 10m <message>",
          "- /cron add at 2026-02-26T01:40:00+09:00 <message>",
          "- /cron add cron 40 1 * * * tz Asia/Seoul <message>",
          "- 자연어: '10분 후 알림 ...', '오후 3시 알림 ...'",
        ].join("\n"));
        return true;
      }

      const job = await this.cron.add_job(
        spec.name, spec.schedule, spec.message,
        spec.deliver, provider, message.chat_id, spec.delete_after_run,
      );
      const j = job as unknown as Record<string, unknown>;
      const state = (j.state && typeof j.state === "object") ? j.state as Record<string, unknown> : {};
      await ctx.send_reply([
        `${mention}cron 등록 완료`,
        `- id: ${j.id || "(unknown)"}`,
        `- name: ${j.name || "(no-name)"}`,
        `- schedule: ${render_schedule(j.schedule)}`,
        `- next_run: ${format_time_kr(state.next_run_at_ms)}`,
        `- auto_remove: ${j.delete_after_run === true ? "yes" : "no"}`,
      ].join("\n"));
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.send_reply(`${mention}cron ${action || "add"} 처리 실패: ${reason}`);
      return true;
    }
  }
}
