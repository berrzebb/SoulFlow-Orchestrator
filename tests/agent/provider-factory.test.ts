/**
 * provider-factory — register/get/list/create_agent_provider 커버리지.
 * 빌트인 CLI 팩토리는 ContainerPool/AgentBus 생성 포함이므로 mock 불필요한 sdk/openai_compatible 계열만 직접 검증.
 */
import { describe, it, expect, vi } from "vitest";
import {
  register_agent_provider_factory,
  get_agent_provider_factory,
  list_registered_provider_types,
  create_agent_provider,
} from "@src/agent/provider-factory.js";
import type { AgentProviderConfig } from "@src/agent/agent.types.js";

function make_config(provider_type: string, settings: Record<string, unknown> = {}): AgentProviderConfig {
  return {
    instance_id: "test-inst",
    name: "test",
    provider_type,
    settings,
  } as any;
}

function make_deps(workspace = "/tmp/ws") {
  return { provider_registry: {} as any, workspace };
}

// ══════════════════════════════════════════
// register / get / list
// ══════════════════════════════════════════

describe("register_agent_provider_factory / get / list", () => {
  it("등록 → get으로 조회 가능", () => {
    const factory = vi.fn().mockReturnValue({ is_available: () => true });
    register_agent_provider_factory("__test_type_a__", factory);
    expect(get_agent_provider_factory("__test_type_a__")).toBe(factory);
  });

  it("대소문자 무관 — 대문자 등록 → 소문자로도 조회", () => {
    const factory = vi.fn();
    register_agent_provider_factory("__TEST_TYPE_B__", factory);
    expect(get_agent_provider_factory("__test_type_b__")).toBe(factory);
  });

  it("미등록 타입 → null 반환", () => {
    expect(get_agent_provider_factory("totally_unknown_xyz")).toBeNull();
  });

  it("list_registered_provider_types → 등록된 타입 포함", () => {
    register_agent_provider_factory("__test_list_type__", vi.fn());
    const types = list_registered_provider_types();
    expect(types).toContain("__test_list_type__");
  });

  it("빌트인 타입들 포함 검증", () => {
    const types = list_registered_provider_types();
    expect(types).toContain("claude_sdk");
    expect(types).toContain("codex_appserver");
    expect(types).toContain("openai_compatible");
    expect(types).toContain("openrouter");
    expect(types).toContain("claude_cli");
    expect(types).toContain("codex_cli");
    expect(types).toContain("container_cli");
  });
});

// ══════════════════════════════════════════
// create_agent_provider
// ══════════════════════════════════════════

describe("create_agent_provider", () => {
  it("미등록 타입 → null 반환", () => {
    const result = create_agent_provider(make_config("no_such_type_xyz"), null, make_deps());
    expect(result).toBeNull();
  });

  it("등록된 커스텀 팩토리 → 호출 + 결과 반환", () => {
    const mock_backend = { is_available: () => true, id: "custom" };
    const factory = vi.fn().mockReturnValue(mock_backend);
    register_agent_provider_factory("__create_test__", factory);

    const config = make_config("__create_test__", { model: "gpt-4" });
    const deps = make_deps();
    const result = create_agent_provider(config, "my-token", deps);

    expect(result).toBe(mock_backend);
    expect(factory).toHaveBeenCalledWith(config, "my-token", deps);
  });

  it("claude_sdk 팩토리 → ClaudeSdkAgent 생성 (is_available 확인)", () => {
    const config = make_config("claude_sdk", { model: "claude-opus-4-6", cwd: "/tmp" });
    const result = create_agent_provider(config, "test-key", make_deps());
    expect(result).not.toBeNull();
    expect(typeof result!.is_available).toBe("function");
  });

  it("claude_sdk: settings.cwd/model 없음 → 기본값으로 생성", () => {
    const config = make_config("claude_sdk", {});
    const result = create_agent_provider(config, null, make_deps());
    expect(result).not.toBeNull();
  });

  it("openai_compatible 팩토리 → OpenAiCompatibleAgent 생성", () => {
    const config = make_config("openai_compatible", { api_base: "https://api.openai.com/v1", model: "gpt-4o" });
    const result = create_agent_provider(config, "tok", make_deps());
    expect(result).not.toBeNull();
    expect(typeof result!.is_available).toBe("function");
  });

  it("openrouter 팩토리 → extra_headers 설정 포함 생성", () => {
    const config = make_config("openrouter", { site_url: "https://myapp.com", app_name: "MyApp" });
    const result = create_agent_provider(config, "or-key", make_deps());
    expect(result).not.toBeNull();
  });

  it("openrouter: site_url/app_name 없음 → extra_headers 없이 생성", () => {
    const config = make_config("openrouter", {});
    const result = create_agent_provider(config, null, make_deps());
    expect(result).not.toBeNull();
  });

  it("codex_appserver 팩토리 → CodexAppServerAgent 생성", () => {
    const config = make_config("codex_appserver", { cwd: "/tmp", model: "o4-mini" });
    const result = create_agent_provider(config, null, make_deps());
    expect(result).not.toBeNull();
  });

  it("codex_appserver: settings 모두 없음 → 기본값으로 생성", () => {
    const config = make_config("codex_appserver", {});
    const result = create_agent_provider(config, null, make_deps());
    expect(result).not.toBeNull();
  });
});
