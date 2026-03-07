/** Phase 4.4 검증: Request Preflight 분리
 *
 * 목표: run_request_preflight가 seal, skill 검색, secret 검증, context를 모두 처리하는지 검증.
 *       discriminated union (ResumedPreflight | ReadyPreflight)이 올바르게 작동하는지 확인.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { RequestPreflightDeps, RequestPreflightResult } from "@src/orchestration/request-preflight.js";
import { run_request_preflight, collect_skill_provider_prefs } from "@src/orchestration/request-preflight.js";
import type { SecretVaultService } from "@src/security/secret-vault.js";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.js";
import type { RuntimePolicyResolver } from "@src/channels/runtime-policy.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

/* ── Mock Implementations ── */

class MockSecretVault implements SecretVaultService {
  async encrypt(): Promise<{ iv: string; ciphertext: string }> {
    return { iv: "", ciphertext: "" };
  }

  async decrypt(): Promise<string> {
    return "";
  }

  async inspect_secret_references() {
    return { missing_keys: [], invalid_ciphertexts: [] };
  }

  put_secret(): void {}
  reveal_secret_value(): Promise<string | null> {
    return Promise.resolve(null);
  }
  mask_known_secrets(): string {
    return "";
  }
}

const mockRuntime: Partial<AgentRuntimeLike> = {
  get_always_skills: () => ["skill1"],
  get_task: async () => null,
  list_active_tasks: () => [],
  get_tool_definitions: () => [],
  get_tool_executors: () => [],
  get_skill_metadata: () => ({ name: "test", summary: "", tools: [], preferred_providers: [] }),
  get_context_builder: () => ({
    get_persona_name: () => "default",
    get_bootstrap: () => ({ exists: false, content: "" }),
    skills_loader: {
      get_skill_metadata: () => ({ name: "test", summary: "", tools: [], preferred_providers: ["prov1", "prov2"] }),
      get_role_skill: () => null,
    },
    build_role_system_prompt: async () => "system",
    build_system_prompt: async () => "system",
  } as any),
  recommend_skills: () => [],
  find_session_by_task: () => null,
};

const mockPolicyResolver: Partial<RuntimePolicyResolver> = {
  resolve: () => ({
    max_turns: 5,
    tools_blocklist: [],
    tools_allowlist: [],
  }),
};

const mockDeps: RequestPreflightDeps = {
  vault: new MockSecretVault(),
  runtime: mockRuntime as AgentRuntimeLike,
  policy_resolver: mockPolicyResolver as RuntimePolicyResolver,
  workspace: "/test",
  tool_index: null,
};

const mockRequest: OrchestrationRequest = {
  message: {
    id: "msg-1",
    provider: "slack",
    channel: "general",
    sender_id: "user1",
    chat_id: "chat1",
    content: "test request",
    at: new Date().toISOString(),
    thread_id: undefined,
    metadata: { message_id: "msg-1" },
  },
  provider: "slack",
  alias: "test",
  run_id: "run-1",
  media_inputs: [],
  session_history: [],
  signal: undefined as any,
};

/* ── Tests ── */

describe("Phase 4.4: Request Preflight 분리", () => {
  describe("run_request_preflight", () => {
    it("정상 경로에서 kind='ready'를 반환한다", async () => {
      const preflight = await run_request_preflight(mockDeps, mockRequest);
      expect(preflight.kind).toBe("ready");
    });

    it("ReadyPreflight가 task_with_media를 포함한다", async () => {
      const preflight = (await run_request_preflight(mockDeps, mockRequest)) as any;
      expect(preflight.task_with_media).toBeDefined();
      expect(typeof preflight.task_with_media).toBe("string");
    });

    it("ReadyPreflight가 skill_names를 포함한다", async () => {
      const preflight = (await run_request_preflight(mockDeps, mockRequest)) as any;
      expect(preflight.skill_names).toBeDefined();
      expect(Array.isArray(preflight.skill_names)).toBe(true);
    });

    it("ReadyPreflight가 secret_guard를 포함한다", async () => {
      const preflight = (await run_request_preflight(mockDeps, mockRequest)) as any;
      expect(preflight.secret_guard).toBeDefined();
      expect(typeof preflight.secret_guard.ok).toBe("boolean");
      expect(Array.isArray(preflight.secret_guard.missing_keys)).toBe(true);
      expect(Array.isArray(preflight.secret_guard.invalid_ciphertexts)).toBe(true);
    });

    it("ReadyPreflight가 context 정보를 모두 포함한다", async () => {
      const preflight = (await run_request_preflight(mockDeps, mockRequest)) as any;
      expect(preflight.runtime_policy).toBeDefined();
      expect(preflight.all_tool_definitions).toBeDefined();
      expect(preflight.request_scope).toBeDefined();
      expect(preflight.request_task_id).toBeDefined();
      expect(preflight.evt_base).toBeDefined();
      expect(preflight.context_block).toBeDefined();
      expect(preflight.tool_ctx).toBeDefined();
    });
  });

  describe("collect_skill_provider_prefs", () => {
    it("스킬 메타에서 preferred_providers를 수집한다", () => {
      const prefs = collect_skill_provider_prefs(mockRuntime as AgentRuntimeLike, ["skill1"]);
      expect(Array.isArray(prefs)).toBe(true);
    });

    it("중복을 제거하고 순서를 유지한다", () => {
      const mockRtWithDups = {
        ...mockRuntime,
        get_context_builder: () => ({
          ...mockRuntime.get_context_builder?.(),
          skills_loader: {
            get_skill_metadata: () => ({
              name: "test",
              summary: "",
              tools: [],
              preferred_providers: ["prov1", "prov2", "prov1"],
            }),
            get_role_skill: () => null,
          },
        }),
      };
      const prefs = collect_skill_provider_prefs(mockRtWithDups as any, ["skill1"]);
      expect(prefs.indexOf("prov1")).toEqual(0); // 첫 번째 위치
      expect(prefs.filter((p) => p === "prov1").length).toEqual(1); // 중복 제거됨
    });
  });
});
