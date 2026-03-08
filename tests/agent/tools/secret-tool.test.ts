/**
 * SecretTool — list/get/set/remove/status 테스트.
 * SecretVaultService를 mock으로 주입해 의존성 없이 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecretTool } from "../../../src/agent/tools/secret-tool.js";
import type { SecretVaultService } from "../../../src/security/secret-vault.js";

function make_mock_vault(overrides: Partial<SecretVaultService> = {}): SecretVaultService {
  return {
    list_names: vi.fn().mockResolvedValue([]),
    get_secret_cipher: vi.fn().mockResolvedValue(null),
    put_secret: vi.fn().mockResolvedValue({ ok: true, name: "test_key" }),
    remove_secret: vi.fn().mockResolvedValue(undefined),
    get_paths: vi.fn().mockReturnValue({ store_path: "/tmp/vault.db" }),
    ...overrides,
  } as unknown as SecretVaultService;
}

describe("SecretTool — list", () => {
  it("등록된 시크릿 없음 → 안내 메시지", async () => {
    const vault = make_mock_vault({ list_names: vi.fn().mockResolvedValue([]) });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "list" });
    expect(result).toContain("없음");
  });

  it("시크릿 있음 → 목록 출력", async () => {
    const vault = make_mock_vault({ list_names: vi.fn().mockResolvedValue(["db_pass", "api_key"]) });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "list" });
    expect(result).toContain("db_pass");
    expect(result).toContain("api_key");
    expect(result).toContain("2개");
  });
});

describe("SecretTool — get", () => {
  it("name 누락 → Error", async () => {
    const tool = new SecretTool(make_mock_vault());
    const result = await tool.execute({ action: "get" });
    expect(result).toContain("Error");
  });

  it("존재하지 않는 시크릿 → '없음' 메시지", async () => {
    const vault = make_mock_vault({ get_secret_cipher: vi.fn().mockResolvedValue(null) });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "get", name: "missing_key" });
    expect(result).toContain("없음");
  });

  it("존재하는 시크릿 → 암호화 정보 반환 (값 노출 없음)", async () => {
    const cipher = "encrypted_cipher_text_here";
    const vault = make_mock_vault({ get_secret_cipher: vi.fn().mockResolvedValue(cipher) });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "get", name: "my_key" });
    expect(result).toContain("my_key");
    expect(result).toContain("암호화됨");
    expect(result).toContain(String(cipher.length));
    // 실제 암호문이 노출되면 안 됨
    expect(result).not.toContain(cipher);
  });
});

describe("SecretTool — set", () => {
  it("name 또는 value 누락 → Error", async () => {
    const tool = new SecretTool(make_mock_vault());
    const r1 = await tool.execute({ action: "set", name: "key" });
    expect(r1).toContain("Error");

    const r2 = await tool.execute({ action: "set", value: "val" });
    expect(r2).toContain("Error");
  });

  it("저장 성공", async () => {
    const vault = make_mock_vault({
      put_secret: vi.fn().mockResolvedValue({ ok: true, name: "db_pass" }),
    });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "set", name: "db_pass", value: "secret123" });
    expect(result).toContain("db_pass");
    expect(result).toContain("저장");
    expect(vi.mocked(vault.put_secret)).toHaveBeenCalledWith("db_pass", "secret123");
  });

  it("저장 실패", async () => {
    const vault = make_mock_vault({
      put_secret: vi.fn().mockResolvedValue({ ok: false, name: "key" }),
    });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "set", name: "key", value: "val" });
    expect(result).toContain("Error");
  });
});

describe("SecretTool — remove", () => {
  it("name 누락 → Error", async () => {
    const tool = new SecretTool(make_mock_vault());
    const result = await tool.execute({ action: "remove" });
    expect(result).toContain("Error");
  });

  it("존재하지 않는 시크릿 → '없음' 메시지", async () => {
    const vault = make_mock_vault({ get_secret_cipher: vi.fn().mockResolvedValue(null) });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "remove", name: "ghost" });
    expect(result).toContain("없음");
  });

  it("존재하는 시크릿 삭제 성공", async () => {
    const vault = make_mock_vault({
      get_secret_cipher: vi.fn().mockResolvedValue("some_cipher"),
      remove_secret: vi.fn().mockResolvedValue(undefined),
    });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "remove", name: "old_key" });
    expect(result).toContain("old_key");
    expect(result).toContain("삭제");
    expect(vi.mocked(vault.remove_secret)).toHaveBeenCalledWith("old_key");
  });
});

describe("SecretTool — status", () => {
  it("시크릿 수 및 경로 반환", async () => {
    const vault = make_mock_vault({
      list_names: vi.fn().mockResolvedValue(["a", "b", "c"]),
      get_paths: vi.fn().mockReturnValue({ store_path: "/data/vault.db" }),
    });
    const tool = new SecretTool(vault);
    const result = await tool.execute({ action: "status" });
    expect(result).toContain("3");
    expect(result).toContain("/data/vault.db");
  });
});

describe("SecretTool — unknown action", () => {
  it("알 수 없는 action → Error", async () => {
    const tool = new SecretTool(make_mock_vault());
    const result = await tool.execute({ action: "unknown" });
    expect(result).toContain("Error");
  });
});
