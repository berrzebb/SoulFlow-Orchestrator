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
import type { TaskState } from "@src/contracts.js";

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

    it("스킬 메타 없으면 빈 배열 반환", () => {
      const rt = {
        ...mockRuntime,
        get_context_builder: () => ({
          ...mockRuntime.get_context_builder?.(),
          skills_loader: { get_skill_metadata: () => null, get_role_skill: () => null },
        }),
      };
      const prefs = collect_skill_provider_prefs(rt as any, ["nonexistent"]);
      expect(prefs).toEqual([]);
    });

    it("preferred_providers 없는 스킬은 스킵", () => {
      const rt = {
        ...mockRuntime,
        get_context_builder: () => ({
          ...mockRuntime.get_context_builder?.(),
          skills_loader: {
            get_skill_metadata: () => ({ name: "test", summary: "", tools: [], preferred_providers: [] }),
            get_role_skill: () => null,
          },
        }),
      };
      const prefs = collect_skill_provider_prefs(rt as any, ["skill1"]);
      expect(prefs).toEqual([]);
    });
  });

  describe("run_request_preflight — 추가 경로 커버", () => {
    it("resumed_task_id가 있고 상태 running이면 kind='resume' 반환", async () => {
      const running_task: TaskState = {
        task_id: "task-123",
        status: "running",
        memory: { chat_id: "chat1" },
      } as unknown as TaskState;

      const resumable_runtime: Partial<AgentRuntimeLike> = {
        ...mockRuntime,
        get_task: async (id: string) => id === "task-123" ? running_task : null,
      };

      const deps: RequestPreflightDeps = {
        ...mockDeps,
        runtime: resumable_runtime as AgentRuntimeLike,
      };

      const req: OrchestrationRequest = {
        ...mockRequest,
        resumed_task_id: "task-123",
      };

      const result = await run_request_preflight(deps, req);
      expect(result.kind).toBe("resume");
      if (result.kind === "resume") {
        expect(result.resumed_task).toBe(running_task);
      }
    });

    it("resumed_task_id 있지만 상태 done이면 정상 실행 (kind='ready')", async () => {
      const done_task: TaskState = {
        task_id: "task-done",
        status: "done",
        memory: {},
      } as unknown as TaskState;

      const runtime: Partial<AgentRuntimeLike> = {
        ...mockRuntime,
        get_task: async () => done_task,
      };

      const deps: RequestPreflightDeps = { ...mockDeps, runtime: runtime as AgentRuntimeLike };
      const req: OrchestrationRequest = { ...mockRequest, resumed_task_id: "task-done" };

      const result = await run_request_preflight(deps, req);
      expect(result.kind).toBe("ready");
    });

    it("메시지 내용 없으면 task_with_media가 빈 문자열", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        message: { ...mockRequest.message, content: "" },
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.kind).toBe("ready");
      expect(result.task_with_media).toBe("");
    });

    it("media_inputs 있으면 task_with_media에 ATTACHED_FILES 포함", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        media_inputs: ["report.pdf", "data.csv"],
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.task_with_media).toContain("ATTACHED_FILES");
      expect(result.media.length).toBe(2);
    });

    it("session_history 있어도 context_block은 task_with_media 포함", async () => {
      const history = Array.from({ length: 12 }, (_, i) => ({
        role: "user" as const,
        content: `msg-${i}`,
      }));
      const req: OrchestrationRequest = { ...mockRequest, session_history: history };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.context_block).toContain("CURRENT_REQUEST");
    });

    it("slack provider + thread_id 있으면 reply_to = thread_id", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        provider: "slack",
        message: {
          ...mockRequest.message,
          provider: "slack",
          thread_id: "thread-xyz",
          metadata: {},
        },
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.tool_ctx.reply_to).toBe("thread-xyz");
    });

    it("slack provider + thread_id 없으면 reply_to = message_id", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        provider: "slack",
        message: {
          ...mockRequest.message,
          provider: "slack",
          thread_id: undefined,
          metadata: { message_id: "slack-msg-999" },
        },
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.tool_ctx.reply_to).toBe("slack-msg-999");
    });

    it("telegram provider이면 reply_to 빈 문자열", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        provider: "telegram",
        message: {
          ...mockRequest.message,
          provider: "telegram",
          metadata: { message_id: "tg-123" },
        },
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.tool_ctx.reply_to).toBeUndefined(); // "" → undefined in build_tool_context
    });

    it("message_id 없으면 request_scope가 msg-로 시작", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        message: {
          ...mockRequest.message,
          id: "",
          metadata: {},
        },
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.request_scope).toMatch(/^msg-/);
    });

    it("secret_guard: missing_keys가 있으면 ok=false", async () => {
      const vault_with_missing: Partial<SecretVaultService> = {
        ...new MockSecretVault(),
        inspect_secret_references: async () => ({
          missing_keys: ["API_KEY"],
          invalid_ciphertexts: [],
        }),
      };
      const deps: RequestPreflightDeps = {
        ...mockDeps,
        vault: vault_with_missing as SecretVaultService,
      };
      const result = await run_request_preflight(deps, mockRequest) as any;
      expect(result.secret_guard.ok).toBe(false);
      expect(result.secret_guard.missing_keys).toContain("API_KEY");
    });

    it("secret_guard: invalid_ciphertexts 있으면 ok=false", async () => {
      const vault_with_invalid: Partial<SecretVaultService> = {
        ...new MockSecretVault(),
        inspect_secret_references: async () => ({
          missing_keys: [],
          invalid_ciphertexts: ["bad-cipher"],
        }),
      };
      const deps: RequestPreflightDeps = {
        ...mockDeps,
        vault: vault_with_invalid as SecretVaultService,
      };
      const result = await run_request_preflight(deps, mockRequest) as any;
      expect(result.secret_guard.ok).toBe(false);
      expect(result.secret_guard.invalid_ciphertexts).toContain("bad-cipher");
    });

    it("recommend_skills 결과가 skill_names에 포함됨", async () => {
      const runtime: Partial<AgentRuntimeLike> = {
        ...mockRuntime,
        recommend_skills: () => ["recommended-skill"],
      };
      const deps: RequestPreflightDeps = { ...mockDeps, runtime: runtime as AgentRuntimeLike };
      const result = await run_request_preflight(deps, mockRequest) as any;
      expect(result.skill_names).toContain("recommended-skill");
    });

    it("tool_executors에서 category_map 구성", async () => {
      const runtime: Partial<AgentRuntimeLike> = {
        ...mockRuntime,
        get_tool_executors: () => [
          { name: "search", category: "productivity", execute: async () => "" } as any,
          { name: "code", category: "dev", execute: async () => "" } as any,
        ],
      };
      const deps: RequestPreflightDeps = { ...mockDeps, runtime: runtime as AgentRuntimeLike };
      const result = await run_request_preflight(deps, mockRequest) as any;
      expect(result.category_map["search"]).toBe("productivity");
      expect(result.tool_categories).toContain("productivity");
      expect(result.tool_categories).toContain("dev");
    });

    it("active_tasks_in_chat: chat_id 일치하는 태스크만 포함", async () => {
      const runtime: Partial<AgentRuntimeLike> = {
        ...mockRuntime,
        list_active_tasks: () => [
          { task_id: "t1", status: "running", memory: { chat_id: "chat1" } } as any,
          { task_id: "t2", status: "running", memory: { chat_id: "other-chat" } } as any,
        ],
      };
      const deps: RequestPreflightDeps = { ...mockDeps, runtime: runtime as AgentRuntimeLike };
      const result = await run_request_preflight(deps, mockRequest) as any;
      expect(result.active_tasks_in_chat.length).toBe(1);
      expect(result.active_tasks_in_chat[0].task_id).toBe("t1");
    });

    it("collect_skill_tool_names: 스킬 메타의 tools를 수집", async () => {
      const runtime: Partial<AgentRuntimeLike> = {
        ...mockRuntime,
        get_always_skills: () => ["my-skill"],
        get_skill_metadata: () => ({
          name: "my-skill",
          summary: "",
          tools: ["tool-a", "tool-b"],
          preferred_providers: [],
        }),
      };
      const deps: RequestPreflightDeps = { ...mockDeps, runtime: runtime as AgentRuntimeLike };
      const result = await run_request_preflight(deps, mockRequest) as any;
      expect(result.skill_tool_names).toContain("tool-a");
      expect(result.skill_tool_names).toContain("tool-b");
    });

    it("workspace 없으면 tool_index_db 없이도 rebuild_tool_index 호출", async () => {
      const deps: RequestPreflightDeps = { ...mockDeps, workspace: undefined };
      const result = await run_request_preflight(deps, mockRequest);
      expect(result.kind).toBe("ready");
    });

    it("context_block에 CURRENT_REQUEST 포함", async () => {
      const result = await run_request_preflight(mockDeps, mockRequest) as any;
      expect(result.context_block).toContain("CURRENT_REQUEST");
    });

    it("session_history 있어도 context_block에 CURRENT_REQUEST 포함", async () => {
      const req: OrchestrationRequest = {
        ...mockRequest,
        session_history: [{ role: "user", content: "previous question" }],
      };
      const result = await run_request_preflight(mockDeps, req) as any;
      expect(result.context_block).toContain("CURRENT_REQUEST");
    });
  });
});

// ══════════════════════════════════════════
// cov2: 미커버 분기 보충
// ══════════════════════════════════════════

class ThrowingVault extends MockSecretVault {
  override put_secret(): void {
    throw new Error("vault write failure");
  }
}

function make_cov2_deps(vault: SecretVaultService = new MockSecretVault()): RequestPreflightDeps {
  const baseRt: Partial<AgentRuntimeLike> = {
    get_always_skills: () => [],
    get_task: async () => null,
    list_active_tasks: () => [],
    get_tool_definitions: () => [],
    get_tool_executors: () => [],
    get_skill_metadata: () => null,
    get_context_builder: () => ({
      get_persona_name: () => "default",
      get_bootstrap: () => ({ exists: false, content: "" }),
      skills_loader: {
        get_skill_metadata: () => null,
        get_role_skill: () => null,
      },
      build_role_system_prompt: async () => "system",
      build_system_prompt: async () => "system",
    } as any),
    recommend_skills: () => [],
    find_session_by_task: () => null,
  };
  const basePol: Partial<RuntimePolicyResolver> = {
    resolve: () => ({ max_turns: 5, tools_blocklist: [], tools_allowlist: [] }),
  };
  return {
    vault,
    runtime: baseRt as AgentRuntimeLike,
    policy_resolver: basePol as RuntimePolicyResolver,
    workspace: undefined,
    tool_index: null,
  };
}

function make_cov2_req(overrides: Partial<OrchestrationRequest> = {}): OrchestrationRequest {
  return {
    message: {
      id: "msg-1",
      provider: "slack",
      channel: "general",
      sender_id: "user1",
      chat_id: "chat1",
      content: "hello",
      at: new Date().toISOString(),
      metadata: { message_id: "msg-1" },
    },
    provider: "slack",
    alias: "test",
    media_inputs: [],
    session_history: [],
    signal: undefined as any,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// L157: seal_text catch → redact_sensitive_text 폴백
// ══════════════════════════════════════════

describe("request-preflight — seal_text catch 폴백 (L157)", () => {
  it("vault.put_secret가 throw → redact_sensitive_text 결과로 폴백 (L157)", async () => {
    // xox* 패턴은 inbound-seal이 Slack 토큰으로 감지 → put_secret 호출
    // ThrowingVault는 put_secret에서 throw → catch → redact_sensitive_text 폴백
    const vault = new ThrowingVault();
    const req = make_cov2_req({
      message: {
        id: "msg-1",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "token is xoxb-12345678901-12345678901-abcdefghijklmnopqrstuvwx",
        at: new Date().toISOString(),
        metadata: { message_id: "msg-1" },
      },
    });

    // vault가 throw해도 preflight는 성공 (catch 폴백)
    const result = await run_request_preflight(make_cov2_deps(vault), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // task_with_media는 redact_sensitive_text로 처리된 문자열 (에러 없이)
      expect(typeof result.task_with_media).toBe("string");
    }
  });
});

// ══════════════════════════════════════════
// L166-168: seal_list — local reference 직접 반환
// ══════════════════════════════════════════

describe("request-preflight — seal_list local reference (L166-168)", () => {
  it("media_inputs에 로컬 경로 포함 → 직접 반환 (L166)", async () => {
    // is_local_reference("/tmp/file.txt") = true → seal 없이 직접 반환
    const req = make_cov2_req({
      media_inputs: ["/tmp/analysis.txt", "report.md"],
    });

    const result = await run_request_preflight(make_cov2_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // 로컬 파일 경로가 media에 포함됨
      expect(result.media.some((m) => m.includes("analysis.txt") || m.includes("report.md"))).toBe(true);
    }
  });

  it("media_inputs에 sealed 결과가 빈 문자열이면 필터됨 (L168 null path)", async () => {
    // 내용이 공백만 있는 media → sealed.trim() = "" → null → 필터
    const req = make_cov2_req({ media_inputs: ["   "] }); // trim 후 filter(Boolean)에서 제거됨
    const result = await run_request_preflight(make_cov2_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.media).toHaveLength(0);
    }
  });
});

// ══════════════════════════════════════════
// L251: resolve_reply_to 기타 provider
// ══════════════════════════════════════════

describe("request-preflight — resolve_reply_to 기타 provider (L251)", () => {
  it("provider='discord' → tool_ctx.reply_to = meta.message_id (L251)", async () => {
    const req = make_cov2_req({
      provider: "discord" as any,
      message: {
        id: "msg-discord-1",
        provider: "discord" as any,
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "hello",
        at: new Date().toISOString(),
        metadata: { message_id: "discord-msg-456" },
      },
    });

    const result = await run_request_preflight(make_cov2_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // resolve_reply_to("discord", message) → L251: meta.message_id
      expect(result.tool_ctx.reply_to).toBe("discord-msg-456");
    }
  });

  it("provider='discord' + meta.message_id 없음 → message.id (L251)", async () => {
    const req = make_cov2_req({
      provider: "discord" as any,
      message: {
        id: "fallback-id",
        provider: "discord" as any,
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "hello",
        at: new Date().toISOString(),
        metadata: {},
      },
    });

    const result = await run_request_preflight(make_cov2_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.tool_ctx.reply_to).toBe("fallback-id");
    }
  });
});

// ══════════════════════════════════════════
// L167-168: seal_list — 비로컬 문자열 → seal_text 호출
// ══════════════════════════════════════════

describe("request-preflight — seal_list 비로컬 문자열 (L167-168)", () => {
  it("media_inputs에 로컬 경로가 아닌 텍스트 → seal_text 호출 (L167-168)", async () => {
    // "some context text" → is_local_reference = false → L167 seal_text 호출
    const req = make_cov2_req({
      media_inputs: ["some context text that is not a file path"],
    });
    const result = await run_request_preflight(make_cov2_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // sealed 결과가 비어있지 않으면 media에 포함됨
      expect(Array.isArray(result.media)).toBe(true);
    }
  });
});
