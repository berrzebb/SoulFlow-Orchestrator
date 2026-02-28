import type { CommandContext, CommandHandler } from "./types.js";

/** 등록된 핸들러를 순회하며 첫 번째 매칭되는 핸들러에 위임. 오타 시 퍼지 매칭. */
export class CommandRouter {
  constructor(private readonly handlers: CommandHandler[]) {}

  async try_handle(ctx: CommandContext): Promise<boolean> {
    // 1. 정확한 매칭
    for (const h of this.handlers) {
      if (h.can_handle(ctx) && await h.handle(ctx)) return true;
    }

    // 2. 슬래시 커맨드 퍼지 매칭 (오타 허용, distance ≤ 2)
    if (ctx.command) {
      const corrected = this.fuzzy_match_command(ctx.command.name);
      if (corrected) {
        const fixed_ctx = this.correct_context(ctx, corrected);
        for (const h of this.handlers) {
          if (h.can_handle(fixed_ctx) && await h.handle(fixed_ctx)) return true;
        }
      }
    }

    return false;
  }

  private fuzzy_match_command(input: string): string | null {
    if (!input) return null;
    let best = "";
    let best_dist = Infinity;
    for (const h of this.handlers) {
      const d = levenshtein(input.toLowerCase(), h.name.toLowerCase());
      if (d > 0 && d < best_dist) {
        best_dist = d;
        best = h.name;
      }
    }
    return best_dist <= 2 ? best : null;
  }

  private correct_context(ctx: CommandContext, corrected_name: string): CommandContext {
    if (!ctx.command) return ctx;
    const original_name = ctx.command.name;
    const content = String(ctx.message.content || "");
    const fixed_content = content.replace(
      new RegExp(`^/\\s*${escape_regex(original_name)}`, "i"),
      `/${corrected_name}`,
    );
    return {
      ...ctx,
      text: fixed_content,
      command: { ...ctx.command, name: corrected_name, raw: fixed_content },
      message: { ...ctx.message, content: fixed_content },
    };
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function escape_regex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
