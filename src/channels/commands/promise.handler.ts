import { slash_name_in } from "../slash-command.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

type PromiseScope = "global" | "team" | "agent";
type PromiseStatus = "active" | "superseded" | "archived";
type PromisePriority = 0 | 1 | 2 | 3;
type PromiseSource = "user" | "leader" | "system" | "agent";

export interface PromiseServiceLike {
  append_promise(entry: {
    scope: PromiseScope;
    key: string;
    value: string;
    source?: PromiseSource;
    priority?: PromisePriority;
  }): Promise<{ action: string; record: { canonical_key: string; value: string; updated_at: string } }>;
  list_promises(opts?: { status?: PromiseStatus; limit?: number }): Promise<Array<{ priority: number; canonical_key: string; value: string }>>;
  get_effective_promises(opts?: {
    include_p2?: boolean;
    p1_limit?: number;
    p2_limit?: number;
  }): Promise<Array<{ priority: number; canonical_key: string; value: string }>>;
}

export interface PromiseAccess {
  get_promise_service(): PromiseServiceLike | null;
}

const ALIASES = ["promise", "약속"] as const;

export class PromiseHandler implements CommandHandler {
  readonly name = "promise";

  constructor(private readonly access: PromiseAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return !!ctx.command && slash_name_in(ctx.command.name, ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const { provider, message, command } = ctx;
    const args = (command?.args || []).join(" ").trim();
    const promises = this.access.get_promise_service();
    const mention = format_mention(provider, message.sender_id);

    if (!promises) {
      await ctx.send_reply("promise service unavailable");
      return true;
    }

    const action = parse_action(args);

    if (action === "set") {
      const pair = parse_set_pair(args);
      if (!pair) {
        await ctx.send_reply(`${mention}사용법: /promise set <key> <value> 또는 /promise set <key>=<value>`);
        return true;
      }
      const result = await promises.append_promise({
        scope: "global",
        key: pair.key,
        value: pair.value,
        source: "user",
        priority: 0,
      });
      await ctx.send_reply([
        `${mention}약속 저장 완료`,
        `- action: ${result.action}`,
        `- key: ${result.record.canonical_key}`,
        `- value: ${result.record.value}`,
      ].join("\n"));
      return true;
    }

    const active = await promises.list_promises({ status: "active", limit: 50 });
    const effective = await promises.get_effective_promises({ include_p2: true, p1_limit: 8, p2_limit: 6 });
    const lines = effective.slice(0, 12).map((r) => `- [P${r.priority}] ${r.canonical_key}: ${r.value}`);
    await ctx.send_reply([
      `${mention}현재 약속(제약 조건)`,
      `- active: ${active.length}`,
      `- effective: ${effective.length}`,
      lines.length > 0 ? "## 목록" : "## 목록\n- (없음)",
      ...(lines.length > 0 ? lines : []),
    ].join("\n"));
    return true;
  }
}

function parse_action(args: string): "list" | "set" | "status" {
  const first = args.split(/\s+/)[0]?.toLowerCase() || "";
  if (first === "set" || first === "add" || first === "추가") return "set";
  if (first === "list" || first === "목록") return "list";
  return "status";
}

function parse_set_pair(args: string): { key: string; value: string } | null {
  const after_set = args.replace(/^(set|add|추가)\s+/i, "").trim();
  if (!after_set) return null;
  const eq = after_set.indexOf("=");
  if (eq > 0) {
    const key = after_set.slice(0, eq).trim();
    const value = after_set.slice(eq + 1).trim();
    if (key && value) return { key, value };
  }
  const parts = after_set.split(/\s+/);
  if (parts.length >= 2) {
    return { key: parts[0], value: parts.slice(1).join(" ") };
  }
  return null;
}
