/**
 * SecretHandler — 실제 구현 경로 테스트.
 * 모든 action(status, list, set, get, reveal, remove, encrypt, decrypt) 및
 * compound alias, can_handle, 에러 처리 경로 커버.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecretHandler } from "@src/channels/commands/secret.handler.js";
import type { SecretVaultLike } from "@src/security/secret-vault.js";
import type { CommandContext } from "@src/channels/commands/types.js";

function make_vault(overrides: Partial<SecretVaultLike> = {}): SecretVaultLike {
  return {
    ensure_ready: vi.fn().mockResolvedValue(undefined),
    list_names: vi.fn().mockResolvedValue([]),
    get_paths: vi.fn().mockReturnValue({ root_dir: "/ws", store_path: "/ws/secrets.db" }),
    put_secret: vi.fn().mockResolvedValue({ ok: true, name: "test_key" }),
    get_secret_cipher: vi.fn().mockResolvedValue("sv1.aaa.bbb.ccc"),
    reveal_secret: vi.fn().mockResolvedValue("plain_value"),
    remove_secret: vi.fn().mockResolvedValue(true),
    encrypt_text: vi.fn().mockResolvedValue("sv1.enc.xxx.yyy"),
    decrypt_text: vi.fn().mockResolvedValue("decrypted_plain"),
    ...overrides,
  } as unknown as SecretVaultLike;
}

function make_ctx(overrides: {
  command_name?: string;
  args?: string[];
  provider?: string;
} = {}): { ctx: CommandContext; sent: string[] } {
  const sent: string[] = [];
  const ctx: CommandContext = {
    provider: (overrides.provider || "slack") as any,
    message: {
      id: "m1", provider: "slack", channel: "slack",
      sender_id: "U001", chat_id: "C123",
      content: "", at: "2025-01-01T00:00:00Z",
    } as any,
    command: {
      name: overrides.command_name || "secret",
      args: overrides.args || [],
      raw: "",
    },
    text: `/secret ${(overrides.args || []).join(" ")}`,
    send_reply: vi.fn().mockImplementation(async (content: string) => {
      sent.push(content);
    }),
  };
  return { ctx, sent };
}

// ══════════════════════════════════════════
// can_handle
// ══════════════════════════════════════════

describe("SecretHandler — can_handle", () => {
  it("secret 명령 → true", () => {
    const handler = new SecretHandler(make_vault());
    const { ctx } = make_ctx({ command_name: "secret" });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("secrets alias → true", () => {
    const handler = new SecretHandler(make_vault());
    const { ctx } = make_ctx({ command_name: "secrets" });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("vault alias → true", () => {
    const handler = new SecretHandler(make_vault());
    const { ctx } = make_ctx({ command_name: "vault" });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("secret-status compound → true", () => {
    const handler = new SecretHandler(make_vault());
    const { ctx } = make_ctx({ command_name: "secret-status" });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("other_command → false", () => {
    const handler = new SecretHandler(make_vault());
    const { ctx } = make_ctx({ command_name: "memory" });
    expect(handler.can_handle(ctx)).toBe(false);
  });
});

// ══════════════════════════════════════════
// handle — action 없음 (서브커맨드 없음)
// ══════════════════════════════════════════

describe("SecretHandler — action 없음 → guide 반환", () => {
  it("/secret → 가이드 반환 또는 false", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: [] });
    const r = await handler.handle(ctx);
    // guide가 있으면 true+reply, 없으면 false
    expect(typeof r).toBe("boolean");
  });
});

// ══════════════════════════════════════════
// handle_status
// ══════════════════════════════════════════

describe("SecretHandler — handle_status", () => {
  it("status → vault 정보 출력", async () => {
    const vault = make_vault({ list_names: vi.fn().mockResolvedValue(["key1", "key2"]) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["status"] });
    const r = await handler.handle(ctx);
    expect(r).toBe(true);
    expect(sent.join("")).toContain("secret vault 상태");
    expect(sent.join("")).toContain("names: 2");
  });

  it("compound secret-status", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret-status", args: [] });
    const r = await handler.handle(ctx);
    expect(r).toBe(true);
    expect(sent.join("")).toContain("secret vault");
  });
});

// ══════════════════════════════════════════
// handle_list
// ══════════════════════════════════════════

describe("SecretHandler — handle_list", () => {
  it("names 있음 → 목록 출력", async () => {
    const vault = make_vault({ list_names: vi.fn().mockResolvedValue(["api_key", "db_pass"]) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["list"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("api_key");
  });

  it("names 없음 → '등록된 secret이 없습니다' 출력", async () => {
    const vault = make_vault({ list_names: vi.fn().mockResolvedValue([]) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["ls"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("없습니다");
  });
});

// ══════════════════════════════════════════
// handle_set
// ══════════════════════════════════════════

describe("SecretHandler — handle_set", () => {
  it("name/value 있음 + saved.ok=true → 저장 완료", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["set", "my_key", "my_value"] });
    const r = await handler.handle(ctx);
    expect(r).toBe(true);
    expect(sent.join("")).toContain("저장 완료");
  });

  it("name 없음 → 사용법 출력", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["set"] });
    await handler.handle(ctx);
    // 사용법 출력 (format_param_usage)
    expect(sent.length).toBeGreaterThan(0);
  });

  it("saved.ok=false → 실패 메시지", async () => {
    const vault = make_vault({ put_secret: vi.fn().mockResolvedValue({ ok: false, name: "" }) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["set", "bad!name", "value"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("실패");
  });

  it("compound secret-set", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret-set", args: ["token", "secret123"] });
    const r = await handler.handle(ctx);
    expect(r).toBe(true);
    expect(sent.join("")).toContain("저장 완료");
  });
});

// ══════════════════════════════════════════
// handle_get
// ══════════════════════════════════════════

describe("SecretHandler — handle_get", () => {
  it("cipher 있음 → ciphertext 출력", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["get", "my_key"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("sv1");
  });

  it("cipher null → 찾지 못함 메시지", async () => {
    const vault = make_vault({ get_secret_cipher: vi.fn().mockResolvedValue(null) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["get", "no_key"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("찾지 못했습니다");
  });

  it("name 없음 → 사용법", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["cipher"] });
    await handler.handle(ctx);
    // get 액션이지만 name 없음
    expect(sent.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// handle_reveal
// ══════════════════════════════════════════

describe("SecretHandler — handle_reveal", () => {
  it("plain 있음 → plaintext 출력", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["reveal", "my_key"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("plain_value");
  });

  it("plain null → 찾지 못함", async () => {
    const vault = make_vault({ reveal_secret: vi.fn().mockResolvedValue(null) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["reveal", "ghost"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("찾지 못했습니다");
  });

  it("name 없음 → 사용법", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["decrypt-name"] });
    await handler.handle(ctx);
    expect(sent.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// handle_remove
// ══════════════════════════════════════════

describe("SecretHandler — handle_remove", () => {
  it("removed=true → 삭제 완료", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["remove", "my_key"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("삭제 완료");
  });

  it("removed=false → 찾지 못함", async () => {
    const vault = make_vault({ remove_secret: vi.fn().mockResolvedValue(false) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["rm", "ghost"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("찾지 못했습니다");
  });

  it("name 없음 → 사용법", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["delete"] });
    await handler.handle(ctx);
    expect(sent.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// handle_encrypt
// ══════════════════════════════════════════

describe("SecretHandler — handle_encrypt", () => {
  it("plain 있음 → encrypt 완료", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["encrypt", "hello", "world"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("encrypt 완료");
    expect(sent.join("")).toContain("sv1");
  });

  it("plain 없음 → 사용법", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["enc"] });
    await handler.handle(ctx);
    expect(sent.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// handle_decrypt
// ══════════════════════════════════════════

describe("SecretHandler — handle_decrypt", () => {
  it("cipher 있음 → decrypt 결과", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["decrypt", "sv1.aaa.bbb.ccc"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("decrypt 결과");
    expect(sent.join("")).toContain("decrypted_plain");
  });

  it("cipher 없음 → 사용법", async () => {
    const handler = new SecretHandler(make_vault());
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["dec"] });
    await handler.handle(ctx);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("decrypt 에러 → 실패 메시지", async () => {
    const vault = make_vault({ decrypt_text: vi.fn().mockRejectedValue(new Error("invalid token")) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["decrypt", "bad-cipher"] });
    await handler.handle(ctx);
    expect(sent.join("")).toContain("실패");
    expect(sent.join("")).toContain("invalid token");
  });
});

// ══════════════════════════════════════════
// handle — telegram 모드 (mention 없음)
// ══════════════════════════════════════════

describe("SecretHandler — telegram 모드", () => {
  it("telegram provider → @ mention 없음", async () => {
    const vault = make_vault({ list_names: vi.fn().mockResolvedValue([]) });
    const handler = new SecretHandler(vault);
    const { ctx, sent } = make_ctx({ command_name: "secret", args: ["status"], provider: "telegram" });
    await handler.handle(ctx);
    // telegram에서는 mention(@sender_id) 없음
    expect(sent.join("")).not.toContain("@U001");
  });
});
