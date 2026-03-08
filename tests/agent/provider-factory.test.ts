/**
 * AgentProviderFactory — 레지스트리 함수 테스트.
 * register_agent_provider_factory, get_agent_provider_factory,
 * list_registered_provider_types, create_agent_provider.
 */
import { describe, it, expect } from "vitest";
import {
  register_agent_provider_factory,
  get_agent_provider_factory,
  list_registered_provider_types,
  create_agent_provider,
} from "@src/agent/provider-factory.js";
import type { AgentProviderConfig } from "@src/agent/agent.types.js";

function make_config(patch: Partial<AgentProviderConfig> = {}): AgentProviderConfig {
  return {
    instance_id: patch.instance_id ?? "test-instance",
    provider_type: patch.provider_type ?? "test_type",
    label: patch.label ?? "Test",
    enabled: patch.enabled ?? true,
    priority: patch.priority ?? 50,
    model_purpose: "chat",
    supported_modes: ["once", "agent", "task"],
    settings: patch.settings ?? {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("AgentProviderFactory — 레지스트리", () => {
  it("register + get_agent_provider_factory: 등록된 팩토리 조회", () => {
    const mock_factory = () => ({} as any);
    register_agent_provider_factory("custom_test_type", mock_factory);

    const retrieved = get_agent_provider_factory("custom_test_type");
    expect(retrieved).toBe(mock_factory);
  });

  it("get_agent_provider_factory: 대소문자 무관 (lowercase 변환)", () => {
    const mock_factory = () => ({} as any);
    register_agent_provider_factory("UPPER_CASE_TYPE", mock_factory);

    const retrieved = get_agent_provider_factory("upper_case_type");
    expect(retrieved).not.toBeNull();
  });

  it("get_agent_provider_factory: 없는 타입 → null", () => {
    expect(get_agent_provider_factory("nonexistent_type_xyz")).toBeNull();
  });

  it("list_registered_provider_types: 빌트인 타입 포함 확인", () => {
    const types = list_registered_provider_types();
    expect(types).toContain("claude_cli");
    expect(types).toContain("codex_cli");
    expect(types).toContain("claude_sdk");
    expect(types).toContain("openai_compatible");
    expect(types).toContain("openrouter");
  });

  it("list_registered_provider_types: 커스텀 등록 타입 포함", () => {
    register_agent_provider_factory("my_custom_provider", () => ({} as any));
    const types = list_registered_provider_types();
    expect(types).toContain("my_custom_provider");
  });

  it("create_agent_provider: 등록된 팩토리로 인스턴스 생성", () => {
    const mock_backend = { id: "mock-backend" };
    register_agent_provider_factory("mock_backend_type", () => mock_backend as any);

    const config = make_config({ provider_type: "mock_backend_type" });
    const deps = { provider_registry: {} as any, workspace: "/tmp" };

    const result = create_agent_provider(config, null, deps);
    expect(result).toBe(mock_backend);
  });

  it("create_agent_provider: 없는 타입 → null", () => {
    const config = make_config({ provider_type: "totally_unknown_type_xyz" });
    const deps = { provider_registry: {} as any, workspace: "/tmp" };

    const result = create_agent_provider(config, null, deps);
    expect(result).toBeNull();
  });

  it("create_agent_provider: 팩토리에 config + token 전달", () => {
    let received_config: AgentProviderConfig | null = null;
    let received_token: string | null = null;

    register_agent_provider_factory("token_test_type", (config, token) => {
      received_config = config;
      received_token = token;
      return {} as any;
    });

    const config = make_config({ provider_type: "token_test_type", instance_id: "my-id" });
    const deps = { provider_registry: {} as any, workspace: "/tmp" };

    create_agent_provider(config, "sk-test-token", deps);
    expect(received_config?.instance_id).toBe("my-id");
    expect(received_token).toBe("sk-test-token");
  });

  it("claude_sdk factory 등록 확인", () => {
    const factory = get_agent_provider_factory("claude_sdk");
    expect(factory).not.toBeNull();
  });

  it("openrouter factory 등록 확인", () => {
    const factory = get_agent_provider_factory("openrouter");
    expect(factory).not.toBeNull();
  });

  it("container_cli factory 등록 확인", () => {
    const factory = get_agent_provider_factory("container_cli");
    expect(factory).not.toBeNull();
  });

  it("gemini_cli factory 등록 확인", () => {
    const factory = get_agent_provider_factory("gemini_cli");
    expect(factory).not.toBeNull();
  });

  it("codex_appserver factory 등록 확인", () => {
    const factory = get_agent_provider_factory("codex_appserver");
    expect(factory).not.toBeNull();
  });
});
