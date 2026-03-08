/**
 * OAuth presets — register/get/list/unregister 테스트.
 * 주의: 전역 레지스트리를 사용하므로 각 테스트 후 정리 필요.
 */
import { describe, it, expect, afterEach } from "vitest";
import { register_preset, get_preset, list_presets, unregister_preset } from "../../src/oauth/presets.js";

const TEST_PRESET = {
  service_type: "test_oauth_service",
  label: "Test OAuth",
  auth_url: "https://test.example.com/auth",
  token_url: "https://test.example.com/token",
  scopes_available: ["read", "write"],
  default_scopes: ["read"],
  supports_refresh: true,
};

describe("OAuth presets", () => {
  afterEach(() => {
    unregister_preset("test_oauth_service");
    unregister_preset("another_service");
  });

  it("register_preset + get_preset: 등록 후 조회", () => {
    register_preset(TEST_PRESET);
    const preset = get_preset("test_oauth_service");
    expect(preset).not.toBeNull();
    expect(preset!.label).toBe("Test OAuth");
    expect(preset!.auth_url).toBe("https://test.example.com/auth");
  });

  it("get_preset: 미등록 서비스 → null", () => {
    expect(get_preset("nonexistent")).toBeNull();
  });

  it("list_presets: 등록된 프리셋 + custom 포함", () => {
    register_preset(TEST_PRESET);
    const presets = list_presets();
    const types = presets.map(p => p.service_type);
    expect(types).toContain("test_oauth_service");
    expect(types).toContain("custom");
  });

  it("list_presets: custom 항목은 항상 마지막에 포함", () => {
    const presets = list_presets();
    const last = presets[presets.length - 1];
    expect(last.service_type).toBe("custom");
  });

  it("unregister_preset: 등록된 프리셋 제거 → true", () => {
    register_preset(TEST_PRESET);
    const result = unregister_preset("test_oauth_service");
    expect(result).toBe(true);
    expect(get_preset("test_oauth_service")).toBeNull();
  });

  it("unregister_preset: 미등록 프리셋 → false", () => {
    expect(unregister_preset("ghost_service")).toBe(false);
  });

  it("register_preset: 덮어쓰기 가능", () => {
    register_preset(TEST_PRESET);
    register_preset({ ...TEST_PRESET, label: "Updated" });
    expect(get_preset("test_oauth_service")!.label).toBe("Updated");
  });

  it("preset 필드 전체 보존", () => {
    const full_preset = {
      ...TEST_PRESET,
      is_builtin: true,
      token_auth_method: "basic" as const,
      scope_separator: "," as const,
      test_url: "https://test.example.com/me",
      extra_auth_params: { response_type: "code" },
    };
    register_preset(full_preset);
    const got = get_preset("test_oauth_service")!;
    expect(got.token_auth_method).toBe("basic");
    expect(got.scope_separator).toBe(",");
    expect(got.test_url).toBe("https://test.example.com/me");
    expect(got.extra_auth_params).toEqual({ response_type: "code" });
  });
});
