import { slash_name_in } from "../slash-command.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";
import type { TonePreferenceStore } from "../persona-message-renderer.js";
import { get_concept_pack, list_concept_packs } from "../persona-message-renderer.js";

const ROOT_ALIASES = ["tone", "톤"] as const;

const POLITENESS_MAP: Record<string, string> = {
  formal: "formal", 존댓말: "formal", 공손: "formal",
  casual: "casual", 반말: "casual", 편하게: "casual",
  casual_polite: "casual_polite", 친근: "casual_polite", 편안: "casual_polite",
};
const WARMTH_MAP: Record<string, string> = {
  warm: "warm", 따뜻: "warm", 친절: "warm",
  cool: "cool", 사무적: "cool", 차가운: "cool",
  neutral: "neutral",
};
const BREVITY_MAP: Record<string, string> = {
  short: "short", 짧게: "short", 간결: "short",
  detailed: "detailed", 자세: "detailed", 장문: "detailed",
  normal: "normal",
};

export class ToneHandler implements CommandHandler {
  readonly name = "tone";

  constructor(
    private readonly store: TonePreferenceStore,
    private readonly get_chat_key: (ctx: CommandContext) => string,
  ) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ROOT_ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const args = ctx.command?.args_lower || [];
    const ck = this.get_chat_key(ctx);

    if (args.length === 0 || args[0] === "status" || args[0] === "상태") {
      const pref = this.store.get(ck);
      const entries = Object.entries(pref).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        await ctx.send_reply(`${mention}현재 채팅에 설정된 톤 선호가 없습니다. 기본(HEART) 설정을 따릅니다.`);
      } else {
        const lines = entries.map(([k, v]) => `- ${k}: ${v}`);
        await ctx.send_reply([`${mention}현재 톤 설정:`, ...lines].join("\n"));
      }
      return true;
    }

    if (args[0] === "reset" || args[0] === "초기화") {
      this.store.clear(ck);
      await ctx.send_reply(`${mention}톤 설정이 초기화되었습니다. 기본(HEART) 설정을 따릅니다.`);
      return true;
    }

    // /tone concepts — 등록된 concept pack 목록
    if (args[0] === "concepts" || args[0] === "컨셉") {
      const packs = list_concept_packs();
      const lines = packs.map((p) => `- \`${p.id}\` — ${p.label}`);
      await ctx.send_reply([`${mention}등록된 컨셉 팩:`, ...lines].join("\n"));
      return true;
    }

    // /tone casual, /tone 반말, /tone warm short, /tone fantasy_hero 등
    const pref: Record<string, string> = {};
    for (const token of args) {
      if (POLITENESS_MAP[token]) pref.politeness = POLITENESS_MAP[token];
      else if (WARMTH_MAP[token]) pref.warmth = WARMTH_MAP[token];
      else if (BREVITY_MAP[token]) pref.brevity = BREVITY_MAP[token];
      else if (get_concept_pack(token)) pref.concept = token;
    }

    if (Object.keys(pref).length === 0) {
      await ctx.send_reply(`${mention}인식할 수 없는 톤 지정입니다. 사용 예: \`/tone casual\`, \`/tone 반말 짧게\`, \`/tone fantasy_hero\`, \`/tone reset\`, \`/tone concepts\``);
      return true;
    }

    this.store.set(ck, pref);
    const desc = Object.entries(pref).map(([k, v]) => `${k}: ${v}`).join(", ");
    await ctx.send_reply(`${mention}톤 설정이 저장되었습니다: ${desc}`);
    return true;
  }
}
