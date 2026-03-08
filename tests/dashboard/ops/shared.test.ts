/**
 * dashboard/ops/shared — apply_connection_api_base / sanitize_rel_path / sanitize_filename / is_inside / activate_provider.
 */
import { describe, it, expect, vi } from "vitest";
import { apply_connection_api_base, sanitize_rel_path, sanitize_filename, is_inside, activate_provider } from "@src/dashboard/ops/shared.js";

// ── 헬퍼 ────────────────────────────────────────

function make_store(resolved: string | null = null) {
  return {
    resolve_api_base: vi.fn().mockReturnValue(resolved),
    get: vi.fn(),
    set_token: vi.fn().mockResolvedValue(undefined),
    resolve_token: vi.fn().mockResolvedValue(null),
  };
}

function make_config(api_base: string | undefined = undefined) {
  return {
    instance_id: "inst-1",
    provider_type: "claude_sdk",
    settings: { api_base } as Record<string, unknown>,
  } as any;
}

// ══════════════════════════════════════════
// apply_connection_api_base
// ══════════════════════════════════════════

describe("apply_connection_api_base", () => {
  it("resolve_api_base 값이 다름 → api_base 덮어씀", () => {
    const store = make_store("https://custom.api.example.com/v1");
    const config = make_config("https://default.api.example.com/v1");
    const result = apply_connection_api_base(store as any, config);
    expect(result.settings.api_base).toBe("https://custom.api.example.com/v1");
  });

  it("resolve_api_base가 null → 원본 반환", () => {
    const store = make_store(null);
    const config = make_config("https://default.api.example.com/v1");
    const result = apply_connection_api_base(store as any, config);
    expect(result).toBe(config);
  });

  it("resolve_api_base가 기존 값과 동일 → 원본 반환", () => {
    const same_base = "https://same.api.example.com/v1";
    const store = make_store(same_base);
    const config = make_config(same_base);
    const result = apply_connection_api_base(store as any, config);
    expect(result).toBe(config);
  });

  it("설정에 api_base 없음 + resolve 반환 있음 → 머지", () => {
    const store = make_store("https://new.api.example.com/v1");
    const config = make_config(undefined);
    const result = apply_connection_api_base(store as any, config);
    expect(result.settings.api_base).toBe("https://new.api.example.com/v1");
  });
});

// ══════════════════════════════════════════
// sanitize_rel_path
// ══════════════════════════════════════════

describe("sanitize_rel_path", () => {
  it("경로 탈출 시도 제거", () => {
    const result = sanitize_rel_path("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).not.toMatch(/^[/\\]/);
  });

  it("정상 상대 경로 → 그대로 유지", () => {
    const result = sanitize_rel_path("data/logs/app.log");
    expect(result).toBe("data/logs/app.log");
  });

  it("선행 슬래시 제거", () => {
    const result = sanitize_rel_path("/etc/passwd");
    expect(result).not.toMatch(/^[/\\]/);
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(sanitize_rel_path("")).toBe("");
  });

  it(".. 만 있음 → 빈 문자열", () => {
    expect(sanitize_rel_path("..")).toBe("");
  });
});

// ══════════════════════════════════════════
// sanitize_filename
// ══════════════════════════════════════════

describe("sanitize_filename", () => {
  it("경로 구분자 제거", () => {
    const result = sanitize_filename("path/to/file.txt");
    expect(result).not.toContain("/");
  });

  it("백슬래시 제거", () => {
    const result = sanitize_filename("path\\to\\file.txt");
    expect(result).not.toContain("\\");
  });

  it(".. 제거", () => {
    const result = sanitize_filename("../etc/passwd");
    expect(result).not.toContain("..");
  });

  it("정상 파일명 → 그대로 유지", () => {
    expect(sanitize_filename("report.pdf")).toBe("report.pdf");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(sanitize_filename("")).toBe("");
  });
});

// ══════════════════════════════════════════
// is_inside
// ══════════════════════════════════════════

describe("is_inside", () => {
  it("target이 base 하위 → true", () => {
    expect(is_inside("/workspace", "/workspace/project/file.txt")).toBe(true);
  });

  it("target이 base와 동일 → true", () => {
    expect(is_inside("/workspace", "/workspace")).toBe(true);
  });

  it("target이 base 밖 → false", () => {
    expect(is_inside("/workspace", "/etc/passwd")).toBe(false);
  });

  it("base prefix 공유하지만 다른 디렉토리 → false", () => {
    // /workspace vs /workspace-other (is_inside should return false)
    expect(is_inside("/workspace", "/workspace-other/file.txt")).toBe(false);
  });
});

// ══════════════════════════════════════════
// activate_provider
// ══════════════════════════════════════════

describe("activate_provider", () => {
  it("config 없음 → 조기 반환 (backend 등록 안 됨)", async () => {
    const store = { ...make_store(), get: vi.fn().mockReturnValue(null) };
    const backends = { register: vi.fn() };
    const registry = {} as any;
    await activate_provider(store as any, backends as any, registry, "/ws", "no-exist-inst");
    expect(backends.register).not.toHaveBeenCalled();
  });

  it("token 있음 → set_token 호출", async () => {
    const config = make_config();
    const store = {
      ...make_store(),
      get: vi.fn().mockReturnValue(null), // config 없어서 조기 반환
      set_token: vi.fn().mockResolvedValue(undefined),
    };
    const backends = { register: vi.fn() };
    await activate_provider(store as any, backends as any, {} as any, "/ws", "inst-1", "my-token");
    expect(store.set_token).toHaveBeenCalledWith("inst-1", "my-token");
  });

  it("token 없음 → set_token 호출 안 됨", async () => {
    const store = {
      ...make_store(),
      get: vi.fn().mockReturnValue(null),
    };
    const backends = { register: vi.fn() };
    await activate_provider(store as any, backends as any, {} as any, "/ws", "inst-1");
    expect(store.set_token).not.toHaveBeenCalled();
  });
});
