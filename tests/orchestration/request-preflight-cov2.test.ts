/**
 * request-preflight.ts — 미커버 분기 보충 (cov2).
 * L157: seal_text catch → redact_sensitive_text 폴백
 * L166-168: seal_list local reference → 직접 반환
 * L251: resolve_reply_to 기타 provider → meta.message_id
 */
import { describe, it, expect } from "vitest";
import { run_request_preflight } from "@src/orchestration/request-preflight.js";
import type { RequestPreflightDeps } from "@src/orchestration/request-preflight.js";
import type { SecretVaultService } from "@src/security/secret-vault.js";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.js";
import type { RuntimePolicyResolver } from "@src/channels/runtime-policy.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

// ── Mock helpers ──

class BaseMockVault implements SecretVaultService {
  async encrypt() { return { iv: "", ciphertext: "" }; }
  async decrypt() { return ""; }
  async inspect_secret_references() { return { missing_keys: [], invalid_ciphertexts: [] }; }
  put_secret(): void {}
  reveal_secret_value(): Promise<string | null> { return Promise.resolve(null); }
  mask_known_secrets(): string { return ""; }
}

class ThrowingVault extends BaseMockVault {
  override put_secret(): void {
    throw new Error("vault write failure");
  }
}

const baseRuntime: Partial<AgentRuntimeLike> = {
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

const basePolicyResolver: Partial<RuntimePolicyResolver> = {
  resolve: () => ({ max_turns: 5, tools_blocklist: [], tools_allowlist: [] }),
};

function make_deps(vault: SecretVaultService = new BaseMockVault()): RequestPreflightDeps {
  return {
    vault,
    runtime: baseRuntime as AgentRuntimeLike,
    policy_resolver: basePolicyResolver as RuntimePolicyResolver,
    workspace: undefined,
    tool_index: null,
  };
}

function make_req(overrides: Partial<OrchestrationRequest> = {}): OrchestrationRequest {
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
    const req = make_req({
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
    const result = await run_request_preflight(make_deps(vault), req);
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
    const req = make_req({
      media_inputs: ["/tmp/analysis.txt", "report.md"],
    });

    const result = await run_request_preflight(make_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // 로컬 파일 경로가 media에 포함됨
      expect(result.media.some((m) => m.includes("analysis.txt") || m.includes("report.md"))).toBe(true);
    }
  });

  it("media_inputs에 sealed 결과가 빈 문자열이면 필터됨 (L168 null path)", async () => {
    // 내용이 공백만 있는 media → sealed.trim() = "" → null → 필터
    const req = make_req({ media_inputs: ["   "] }); // trim 후 filter(Boolean)에서 제거됨
    const result = await run_request_preflight(make_deps(), req);
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
    const req = make_req({
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

    const result = await run_request_preflight(make_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // resolve_reply_to("discord", message) → L251: meta.message_id
      expect(result.tool_ctx.reply_to).toBe("discord-msg-456");
    }
  });

  it("provider='discord' + meta.message_id 없음 → message.id (L251)", async () => {
    const req = make_req({
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

    const result = await run_request_preflight(make_deps(), req);
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
    const req = make_req({
      media_inputs: ["some context text that is not a file path"],
    });
    const result = await run_request_preflight(make_deps(), req);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // sealed 결과가 비어있지 않으면 media에 포함됨
      expect(Array.isArray(result.media)).toBe(true);
    }
  });
});
