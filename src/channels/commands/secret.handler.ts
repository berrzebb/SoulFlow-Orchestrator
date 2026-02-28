import { slash_name_in, slash_token_in } from "../slash-command.js";
import type { SecretVaultLike } from "../../security/secret-vault.js";
import { format_mention, type CommandContext, type CommandHandler } from "./types.js";

const ROOT_ALIASES = ["secret", "secrets", "vault", "비밀"] as const;
const STATUS_ALIASES = ["status", "show", "상태"] as const;
const LIST_ALIASES = ["list", "ls", "목록"] as const;
const SET_ALIASES = ["set", "put", "저장"] as const;
const GET_ALIASES = ["get", "cipher", "암호문"] as const;
const REVEAL_ALIASES = ["reveal", "decrypt-name", "평문", "복호화"] as const;
const REMOVE_ALIASES = ["remove", "rm", "delete", "삭제"] as const;
const ENCRYPT_ALIASES = ["encrypt", "enc", "암호화"] as const;
const DECRYPT_ALIASES = ["decrypt", "dec", "복호화문"] as const;

const COMPOUND_ALIASES: ReadonlyMap<string, string> = new Map([
  ...["secret-status", "secret_status", "비밀상태", "시크릿상태"].map((a) => [a, "status"] as const),
  ...["secret-list", "secret_list", "비밀목록", "시크릿목록"].map((a) => [a, "list"] as const),
  ...["secret-set", "secret_set", "비밀저장", "시크릿저장"].map((a) => [a, "set"] as const),
  ...["secret-get", "secret_get", "비밀조회", "시크릿조회"].map((a) => [a, "get"] as const),
  ...["secret-reveal", "secret_reveal", "비밀평문", "시크릿평문"].map((a) => [a, "reveal"] as const),
  ...["secret-remove", "secret_remove", "secret-delete", "secret_delete", "비밀삭제", "시크릿삭제"].map((a) => [a, "remove"] as const),
  ...["secret-encrypt", "secret_encrypt", "비밀암호화", "시크릿암호화"].map((a) => [a, "encrypt"] as const),
  ...["secret-decrypt", "secret_decrypt", "비밀복호화", "시크릿복호화"].map((a) => [a, "decrypt"] as const),
]);

type SecretAction = "status" | "list" | "set" | "get" | "reveal" | "remove" | "encrypt" | "decrypt";

function resolve_action(command_name: string, arg0: string): SecretAction | null {
  const compound = COMPOUND_ALIASES.get(command_name.toLowerCase());
  if (compound) return compound as SecretAction;
  if (!slash_name_in(command_name, ROOT_ALIASES)) return null;
  if (!arg0 || slash_token_in(arg0, STATUS_ALIASES)) return "status";
  if (slash_token_in(arg0, LIST_ALIASES)) return "list";
  if (slash_token_in(arg0, SET_ALIASES)) return "set";
  if (slash_token_in(arg0, GET_ALIASES)) return "get";
  if (slash_token_in(arg0, REVEAL_ALIASES)) return "reveal";
  if (slash_token_in(arg0, REMOVE_ALIASES)) return "remove";
  if (slash_token_in(arg0, ENCRYPT_ALIASES)) return "encrypt";
  if (slash_token_in(arg0, DECRYPT_ALIASES)) return "decrypt";
  return null;
}

function format_usage(mention: string): string {
  return [
    `${mention}secret 명령 사용법`,
    "- /secret status | list | set <name> <value> | get <name>",
    "- /secret reveal <name> | remove <name>",
    "- /secret encrypt <text> | decrypt <cipher>",
    "- exec에서 {{secret:name}} 형태로 참조 가능",
  ].join("\n");
}

export class SecretHandler implements CommandHandler {
  readonly name = "secret";

  constructor(private readonly vault: SecretVaultLike) {}

  can_handle(ctx: CommandContext): boolean {
    const cmd_name = ctx.command?.name || "";
    return slash_name_in(cmd_name, ROOT_ALIASES) || COMPOUND_ALIASES.has(cmd_name.toLowerCase());
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const { provider, message, command } = ctx;
    const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
    const args_lower = args.map((v) => v.toLowerCase());
    const cmd_name = String(command?.name || "");
    const is_root = slash_name_in(cmd_name, ROOT_ALIASES);
    const action = resolve_action(cmd_name, args_lower[0] || "");
    if (!action) return false;

    const payload_args = is_root ? args.slice(1) : args;
    const mention = format_mention(provider, message.sender_id);

    switch (action) {
      case "status": return this.handle_status(ctx, mention);
      case "list": return this.handle_list(ctx, mention);
      case "set": return this.handle_set(ctx, mention, payload_args);
      case "get": return this.handle_get(ctx, mention, payload_args);
      case "reveal": return this.handle_reveal(ctx, mention, payload_args);
      case "remove": return this.handle_remove(ctx, mention, payload_args);
      case "encrypt": return this.handle_encrypt(ctx, mention, payload_args);
      case "decrypt": return this.handle_decrypt(ctx, mention, payload_args);
    }
  }

  private async handle_status(ctx: CommandContext, mention: string): Promise<boolean> {
    await this.vault.ensure_ready();
    const names = await this.vault.list_names();
    const paths = this.vault.get_paths();
    await ctx.send_reply([
      `${mention}secret vault 상태`,
      `- names: ${names.length}`,
      `- key_path: ${paths.key_path}`,
      `- store_path: ${paths.store_path}`,
    ].join("\n"));
    return true;
  }

  private async handle_list(ctx: CommandContext, mention: string): Promise<boolean> {
    await this.vault.ensure_ready();
    const names = await this.vault.list_names();
    await ctx.send_reply(
      names.length > 0
        ? `${mention}secret 목록\n${names.map((v, i) => `${i + 1}. ${v}`).join("\n")}`
        : `${mention}등록된 secret이 없습니다.`,
    );
    return true;
  }

  private async handle_set(ctx: CommandContext, mention: string, args: string[]): Promise<boolean> {
    const name = args[0] || "";
    const value = args.slice(1).join(" ").trim();
    if (!name || !value) {
      await ctx.send_reply(format_usage(mention));
      return true;
    }
    const saved = await this.vault.put_secret(name, value);
    if (!saved.ok) {
      await ctx.send_reply(`${mention}secret 저장 실패: 유효한 name이 필요합니다.`);
      return true;
    }
    await ctx.send_reply(`${mention}secret 저장 완료: ${saved.name} (AES-256-GCM)`);
    return true;
  }

  private async handle_get(ctx: CommandContext, mention: string, args: string[]): Promise<boolean> {
    const name = args[0] || "";
    if (!name) { await ctx.send_reply(format_usage(mention)); return true; }
    const cipher = await this.vault.get_secret_cipher(name);
    await ctx.send_reply(
      cipher
        ? `${mention}${name} ciphertext\n${cipher}`
        : `${mention}secret을 찾지 못했습니다: ${name}`,
    );
    return true;
  }

  private async handle_reveal(ctx: CommandContext, mention: string, args: string[]): Promise<boolean> {
    const name = args[0] || "";
    if (!name) { await ctx.send_reply(format_usage(mention)); return true; }
    const plain = await this.vault.reveal_secret(name);
    await ctx.send_reply(
      plain !== null
        ? `${mention}${name} plaintext\n${plain}`
        : `${mention}secret을 찾지 못했습니다: ${name}`,
    );
    return true;
  }

  private async handle_remove(ctx: CommandContext, mention: string, args: string[]): Promise<boolean> {
    const name = args[0] || "";
    if (!name) { await ctx.send_reply(format_usage(mention)); return true; }
    const removed = await this.vault.remove_secret(name);
    await ctx.send_reply(
      removed
        ? `${mention}secret 삭제 완료: ${name}`
        : `${mention}secret을 찾지 못했습니다: ${name}`,
    );
    return true;
  }

  private async handle_encrypt(ctx: CommandContext, mention: string, args: string[]): Promise<boolean> {
    const plain = args.join(" ").trim();
    if (!plain) { await ctx.send_reply(format_usage(mention)); return true; }
    const cipher = await this.vault.encrypt_text(plain, "adhoc:secret");
    await ctx.send_reply(`${mention}encrypt 완료\n${cipher}`);
    return true;
  }

  private async handle_decrypt(ctx: CommandContext, mention: string, args: string[]): Promise<boolean> {
    const cipher = args.join(" ").trim();
    if (!cipher) { await ctx.send_reply(format_usage(mention)); return true; }
    try {
      const plain = await this.vault.decrypt_text(cipher, "adhoc:secret");
      await ctx.send_reply(`${mention}decrypt 결과\n${plain}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.send_reply(`${mention}decrypt 실패: ${reason}`);
    }
    return true;
  }
}
