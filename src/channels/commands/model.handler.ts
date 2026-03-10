import { slash_name_in } from "../slash-command.js";
import { format_subcommand_guide } from "./registry.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ALIASES = ["model", "models", "\uBAA8\uB378"] as const;

export interface ModelAccess {
  list(): Array<{ name: string }> | Promise<Array<{ name: string }>>;
  get_default(): string | null;
  set_default(model: string): boolean;
}

export class ModelHandler implements CommandHandler {
  readonly name = "model";

  constructor(private readonly access: ModelAccess) {}

  can_handle(ctx: CommandContext): boolean {
    return slash_name_in(ctx.command?.name || "", ALIASES);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const mention = format_mention(ctx.provider, ctx.message.sender_id);
    const args = ctx.command?.args || [];
    const action = ctx.command?.args_lower?.[0] || "";

    if (action === "set" || action === "\uC124\uC815") {
      const model = args[1] || "";
      if (!model) {
        await ctx.send_reply(`${mention}\uC0AC\uC6A9\uBC95: /model set <model_name>`);
        return true;
      }
      const ok = this.access.set_default(model);
      await ctx.send_reply(`${mention}${ok ? `\u2705 \uAE30\uBCF8 \uBAA8\uB378 \uBCC0\uACBD\uB428: ${model}` : `\u274C \uBAA8\uB378\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4: ${model}`}`);
      return true;
    }

    if (!action) {
      const guide = format_subcommand_guide("model");
      if (guide) { await ctx.send_reply(`${mention}${guide}`); return true; }
    }
    const models = await this.access.list();
    const current = this.access.get_default();
    if (!models.length) {
      await ctx.send_reply(`${mention}\uB4F1\uB85D\uB41C \uBAA8\uB378\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      return true;
    }
    const lines = models.slice(0, 30).map((m) => {
      const marker = m.name === current ? " \u2190 current" : "";
      return `- ${m.name}${marker}`;
    });
    await ctx.send_reply(`${mention}${[`\uBAA8\uB378 ${models.length}\uAC1C${current ? ` (\uAE30\uBCF8: ${current})` : ""}`, "", ...lines].join("\n")}`);
    return true;
  }
}
