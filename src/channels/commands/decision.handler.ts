import {
  parse_decision_quick_action,
  has_explicit_decision_intent,
  extract_decision_set_pair,
  normalize_common_command_text,
} from "../command-intent.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

type DecisionScope = "global" | "team" | "agent";
type DecisionStatus = "active" | "superseded" | "archived";
type DecisionPriority = 0 | 1 | 2 | 3;
type DecisionSource = "user" | "leader" | "system" | "agent";

export interface DecisionServiceLike {
  append_decision(entry: {
    scope: DecisionScope;
    key: string;
    value: string;
    source?: DecisionSource;
    priority?: DecisionPriority;
  }): Promise<{ action: string; record: { canonical_key: string; value: string; updated_at: string } }>;
  list_decisions(opts?: { status?: DecisionStatus; limit?: number }): Promise<Array<{ priority: number; canonical_key: string; value: string }>>;
  get_effective_decisions(opts?: {
    include_p2?: boolean;
    p1_limit?: number;
    p2_limit?: number;
  }): Promise<Array<{ priority: number; canonical_key: string; value: string }>>;
}

export interface DecisionAccess {
  get_decision_service(): DecisionServiceLike | null;
}

function format_usage(mention: string): string {
  return [
    `${mention}decision 명령 사용법`,
    "- /decision status | list | set <key> <value>",
    "- /decision set <key>=<value>",
  ].join("\n");
}

export class DecisionHandler implements CommandHandler {
  readonly name = "decision";

  constructor(private readonly access: DecisionAccess) {}

  can_handle(ctx: CommandContext): boolean {
    const normalized = normalize_common_command_text(String(ctx.message.content || ""));
    return !!parse_decision_quick_action(normalized, ctx.command) || has_explicit_decision_intent(normalized);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const { provider, message, command } = ctx;
    const normalized = normalize_common_command_text(String(message.content || ""));
    const action = parse_decision_quick_action(normalized, command) || "status";
    const decisions = this.access.get_decision_service();
    const mention = format_mention(provider, message.sender_id);

    if (!decisions) {
      await ctx.send_reply("decision service unavailable");
      return true;
    }

    if (action === "set") {
      const pair = extract_decision_set_pair(normalized, command);
      if (!pair) {
        await ctx.send_reply(format_usage(mention));
        return true;
      }
      const result = await decisions.append_decision({
        scope: "global",
        key: pair.key,
        value: pair.value,
        source: "user",
        priority: 1,
      });
      await ctx.send_reply([
        `${mention}결정사항 저장 완료`,
        `- action: ${result.action}`,
        `- key: ${result.record.canonical_key}`,
        `- value: ${result.record.value}`,
        `- updated_at: ${result.record.updated_at}`,
      ].join("\n"));
      return true;
    }

    const active = await decisions.list_decisions({ status: "active", limit: 50 });
    const effective = await decisions.get_effective_decisions({ include_p2: true, p1_limit: 8, p2_limit: 6 });
    const lines = effective.slice(0, 12).map((r) => `- [P${r.priority}] ${r.canonical_key}: ${r.value}`);
    await ctx.send_reply([
      `${mention}현재 지침/결정사항`,
      `- active: ${active.length}`,
      `- effective: ${effective.length}`,
      lines.length > 0 ? "## 목록" : "## 목록\n- (empty)",
      ...(lines.length > 0 ? lines : []),
    ].join("\n"));
    return true;
  }
}
