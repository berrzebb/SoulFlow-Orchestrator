import { slash_name_in, slash_token_in } from "../slash-command.js";
import type { ChannelProvider } from "../types.js";
import {
  type RenderProfile,
  type BlockPolicy,
  normalize_render_mode,
  normalize_block_policy,
  default_render_profile,
} from "../rendering.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ROOT_ALIASES = ["render", "format", "fmt", "렌더", "포맷"] as const;
const STATUS_ALIASES = ["status", "show", "상태"] as const;
const RESET_ALIASES = ["reset", "기본", "초기화"] as const;
const LINK_ALIASES = ["link", "links", "링크"] as const;
const IMAGE_ALIASES = ["image", "images", "img", "이미지"] as const;

/** 채널별 렌더 프로필 CRUD를 위한 최소 인터페이스. */
export interface RenderProfileStore {
  get(provider: ChannelProvider, chat_id: string): RenderProfile;
  set(provider: ChannelProvider, chat_id: string, patch: Partial<RenderProfile>): RenderProfile;
  reset(provider: ChannelProvider, chat_id: string): RenderProfile;
}

/** Map 기반 인메모리 RenderProfileStore 구현. */
export class InMemoryRenderProfileStore implements RenderProfileStore {
  private readonly profiles = new Map<string, RenderProfile>();

  private key(provider: ChannelProvider, chat_id: string): string {
    return `${provider}:${chat_id}`;
  }

  get(provider: ChannelProvider, chat_id: string): RenderProfile {
    return { ...(this.profiles.get(this.key(provider, chat_id)) ?? default_render_profile(provider)) };
  }

  set(provider: ChannelProvider, chat_id: string, patch: Partial<RenderProfile>): RenderProfile {
    const prev = this.get(provider, chat_id);
    const next: RenderProfile = {
      mode: patch.mode ?? prev.mode,
      blocked_link_policy: patch.blocked_link_policy ?? prev.blocked_link_policy,
      blocked_image_policy: patch.blocked_image_policy ?? prev.blocked_image_policy,
    };
    this.profiles.set(this.key(provider, chat_id), next);
    return next;
  }

  reset(provider: ChannelProvider, chat_id: string): RenderProfile {
    this.profiles.delete(this.key(provider, chat_id));
    return this.get(provider, chat_id);
  }
}

function format_status(provider: ChannelProvider, sender_id: string, profile: RenderProfile): string {
  const mention = format_mention(provider, sender_id);
  const effective = provider !== "telegram" && profile.mode === "html" ? "markdown" : profile.mode;
  return [
    `${mention}render 설정`,
    `- mode: ${profile.mode}`,
    `- effective_mode: ${effective}`,
    `- blocked_link_policy: ${profile.blocked_link_policy}`,
    `- blocked_image_policy: ${profile.blocked_image_policy}`,
    "- usage: /render <markdown|html|plain|status|reset>",
    "- usage: /render link <indicator|text|remove>",
    "- usage: /render image <indicator|text|remove>",
  ].join("\n");
}

export class RenderHandler implements CommandHandler {
  readonly name = "render";

  constructor(private readonly store: RenderProfileStore) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ROOT_ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const { provider, message, command } = ctx;
    const args = command?.args_lower || [];
    const arg0 = String(args[0] || "");
    const arg1 = String(args[1] || "");
    const mention = format_mention(provider, message.sender_id);

    if (!arg0 || slash_token_in(arg0, STATUS_ALIASES)) {
      const profile = this.store.get(provider, message.chat_id);
      await ctx.send_reply(format_status(provider, message.sender_id, profile));
      return true;
    }

    if (slash_token_in(arg0, RESET_ALIASES)) {
      const profile = this.store.reset(provider, message.chat_id);
      await ctx.send_reply(
        `${mention}render 설정을 기본값으로 초기화했습니다.\n${format_status(provider, message.sender_id, profile)}`,
      );
      return true;
    }

    const mode = normalize_render_mode(arg0);
    if (mode) {
      const profile = this.store.set(provider, message.chat_id, { mode });
      await ctx.send_reply(
        `${mention}render mode를 '${profile.mode}'로 설정했습니다.\n${format_status(provider, message.sender_id, profile)}`,
      );
      return true;
    }

    const target: "link" | "image" | null = slash_token_in(arg0, LINK_ALIASES)
      ? "link"
      : (slash_token_in(arg0, IMAGE_ALIASES) ? "image" : null);
    if (!target) {
      await ctx.send_reply(`${mention}render 명령을 이해하지 못했습니다. /render status 로 현재 설정을 확인하세요.`);
      return true;
    }

    const policy = normalize_block_policy(arg1);
    if (!policy) {
      await ctx.send_reply(`${mention}policy 값이 필요합니다. indicator | text | remove 중 하나를 입력하세요.`);
      return true;
    }

    const patch: Partial<RenderProfile> = target === "link"
      ? { blocked_link_policy: policy as BlockPolicy }
      : { blocked_image_policy: policy as BlockPolicy };
    const profile = this.store.set(provider, message.chat_id, patch);
    await ctx.send_reply(
      `${mention}${target} blocked policy를 '${policy}'로 설정했습니다.\n${format_status(provider, message.sender_id, profile)}`,
    );
    return true;
  }
}
