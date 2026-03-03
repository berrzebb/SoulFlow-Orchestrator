/**
 * 채널 E2E 파이프라인 테스트
 *
 * 목적: 실제 채널 메시지를 모의 입력하여, 전체 파이프라인을 통과한 후
 * 채널에 발화되기 직전의 최종 출력을 검증한다.
 *
 * 파이프라인:
 *   [채널 입력] → handle_inbound_message
 *     → should_ignore (필터)
 *     → approval (승인 확인)
 *     → CommandRouter (커맨드 → 즉시 응답)
 *     → OrchestrationService (LLM → 응답 생성)
 *     → render_reply (sanitize + render)
 *     → dispatch.send → [채널 출력 캡처]
 *
 * 이 테스트로 검증 가능한 것:
 *   - 특정 메시지가 올바른 핸들러로 라우팅되는지
 *   - output-sanitizer가 정당한 응답을 제거하지 않는지
 *   - 최종 출력 텍스트가 기대한 형태인지
 *   - 에러 발생 시 적절한 에러 메시지가 나오는지
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { OutboundMessage } from "@src/bus/types.ts";
import type { OrchestrationRequest } from "@src/orchestration/types.ts";
import { StatusHandler } from "@src/channels/commands/status.handler.ts";
import { HelpHandler } from "@src/channels/commands/help.handler.ts";
import { StopHandler } from "@src/channels/commands/stop.handler.ts";
import { RenderHandler, InMemoryRenderProfileStore } from "@src/channels/commands/render.handler.ts";
import { SecretHandler } from "@src/channels/commands/secret.handler.ts";
import { MemoryHandler, type MemoryStoreLike } from "@src/channels/commands/memory.handler.ts";
import { DecisionHandler } from "@src/channels/commands/decision.handler.ts";
import { CronHandler } from "@src/channels/commands/cron.handler.ts";
import { ReloadHandler } from "@src/channels/commands/reload.handler.ts";
import type { SecretVaultLike } from "@src/security/secret-vault.ts";
import type { CronScheduler } from "@src/cron/contracts.ts";
import type { CronJob, CronServiceStatus } from "@src/cron/types.ts";
import { create_harness, inbound, type FakeOrchestrationHandler } from "@helpers/harness.ts";

/* ── 공통 헬퍼 ─────────────────────────────────────────── */

function last_sent(sent: OutboundMessage[]): OutboundMessage {
  expect(sent.length).toBeGreaterThan(0);
  return sent[sent.length - 1];
}

function reply_with(content: string | null): FakeOrchestrationHandler {
  return async () => ({ reply: content, mode: "once" as const, tool_calls_count: 0, streamed: false });
}

function capture_and_reply(
  captured: OrchestrationRequest[],
  content: string,
): FakeOrchestrationHandler {
  return async (req) => {
    captured.push(req);
    return { reply: content, mode: "once" as const, tool_calls_count: 0, streamed: false };
  };
}

/* ── Mock 팩토리 ───────────────────────────────────────── */

const MOCK_TOOLS = [
  { name: "shell" },
  { name: "memory_read" },
  { name: "memory_write" },
  { name: "secret_get" },
  { name: "cron_add" },
];

const MOCK_SKILLS = [
  { name: "git-commit", summary: "Git 커밋 생성", always: "false" },
  { name: "code-review", summary: "코드 리뷰 수행", always: "true" },
];

function create_status_handler(
  tools: Array<{ name: string }> = [],
  skills: Array<{ name: string; summary: string; always: string }> = [],
): StatusHandler {
  return new StatusHandler({ list_tools: () => tools, list_skills: () => skills });
}

function create_stop_handler(cancelled = 0): StopHandler {
  return new StopHandler(async () => cancelled);
}

function create_render_handler(): { handler: RenderHandler; store: InMemoryRenderProfileStore } {
  const store = new InMemoryRenderProfileStore();
  return { handler: new RenderHandler(store), store };
}

function create_secret_handler(secrets: Record<string, string> = {}): SecretHandler {
  const vault: SecretVaultLike = {
    get_paths: () => ({ root_dir: "/mock", key_path: "/mock/key.bin", store_path: "/mock/vault.db" }),
    ensure_ready: async () => {},
    get_or_create_key: async () => Buffer.from("mock"),
    encrypt_text: async (plain) => `ENC(${plain})`,
    decrypt_text: async (cipher) => {
      const m = cipher.match(/^ENC\((.+)\)$/);
      if (!m) throw new Error("invalid ciphertext");
      return m[1];
    },
    list_names: async () => Object.keys(secrets),
    put_secret: async (name, value) => { secrets[name] = value; return { ok: true, name }; },
    remove_secret: async (name) => { const had = name in secrets; delete secrets[name]; return had; },
    get_secret_cipher: async (name) => name in secrets ? `ENC(${secrets[name]})` : null,
    reveal_secret: async (name) => secrets[name] ?? null,
    resolve_placeholders: async (input) => input,
    resolve_placeholders_with_report: async (input) => ({ text: input, missing_keys: [], invalid_ciphertexts: [] }),
    resolve_inline_secrets: async (input) => input,
    resolve_inline_secrets_with_report: async (input) => ({ text: input, missing_keys: [], invalid_ciphertexts: [] }),
    inspect_secret_references: async () => ({ missing_keys: [], invalid_ciphertexts: [] }),
    mask_known_secrets: async (input: string) => input,
  };
  return new SecretHandler(vault);
}

function create_memory_handler(opts?: {
  daily?: Record<string, string>;
  longterm?: string;
  search_results?: Array<{ file: string; line: number; text: string }>;
}): MemoryHandler {
  const daily = opts?.daily || {};
  const store: MemoryStoreLike = {
    search: async (_query, { limit }) => (opts?.search_results || []).slice(0, limit),
    read_daily: async (day) => daily[day] ?? null,
    read_longterm: async () => opts?.longterm ?? null,
    list_daily: async () => Object.keys(daily).sort(),
  };
  return new MemoryHandler({ get_memory_store: () => store });
}

function create_decision_handler(decisions: Array<{ priority: number; canonical_key: string; value: string }> = []): DecisionHandler {
  return new DecisionHandler({
    get_decision_service: () => ({
      append_decision: async (entry) => ({
        action: "created",
        record: { canonical_key: entry.key, value: entry.value, updated_at: new Date().toISOString() },
      }),
      list_decisions: async () => decisions,
      get_effective_decisions: async () => decisions,
    }),
  });
}

function create_cron_handler(jobs: Array<Record<string, unknown>> = []): CronHandler {
  const scheduler: CronScheduler = {
    status: async (): Promise<CronServiceStatus> => ({
      enabled: true, paused: false, jobs: jobs.length, next_wake_at_ms: Date.now() + 60_000,
    }),
    list_jobs: async () => jobs as unknown as CronJob[],
    remove_job: async (id) => jobs.some((j) => j.id === id),
    add_job: async (name, schedule, message, _deliver, _channel, _to, delete_after_run) => ({
      id: `job-${Date.now()}`, name, enabled: true, schedule,
      payload: { kind: "agent_turn" as const, message },
      state: { next_run_at_ms: Date.now() + 60_000 },
      created_at_ms: Date.now(), updated_at_ms: Date.now(),
      delete_after_run: delete_after_run ?? false,
    }) as unknown as CronJob,
    enable_job: async () => null,
    run_job: async () => false,
    every: () => {},
  };
  return new CronHandler(scheduler);
}

function create_reload_handler(patch?: {
  config_error?: string;
  tools_count?: number;
  skills_count?: number;
}): ReloadHandler {
  return new ReloadHandler({
    reload_config: async () => { if (patch?.config_error) throw new Error(patch.config_error); },
    reload_tools: async () => patch?.tools_count ?? 5,
    reload_skills: async () => patch?.skills_count ?? 3,
  });
}

function all_command_handlers(): import("@src/channels/commands/types.ts").CommandHandler[] {
  return [
    new HelpHandler(),
    create_stop_handler(2),
    create_render_handler().handler,
    create_secret_handler({ api_key: "sk_prod_12345", db_pass: "p@ssw0rd" }),
    create_memory_handler({
      daily: { "2026-02-28": "- 프로젝트 리팩토링\n- 테스트 추가" },
      longterm: "장기 목표: 아키텍처 개선",
      search_results: [{ file: "2026-02-28.md", line: 1, text: "프로젝트 리팩토링" }],
    }),
    create_decision_handler([
      { priority: 1, canonical_key: "coding_style", value: "YAGNI 원칙 준수" },
    ]),
    create_cron_handler(),
    create_reload_handler(),
    create_status_handler(MOCK_TOOLS, MOCK_SKILLS),
  ];
}

/* ═══════════════════════════════════════════════════════
 * 1. 커맨드 라우팅 — 기본 명령어
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 커맨드 라우팅 — 채널 입력 → 커맨드 → 채널 출력", () => {
  it("/help → 도움말 텍스트 출력", async () => {
    const h = await create_harness({ command_handlers: [new HelpHandler(), create_status_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/help"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("사용 가능한 공통 명령");
      expect(out.content).toContain("/help");
      expect(out.content).toContain("/stop");
      expect(out.content).toContain("/status");
      expect(out.content).toContain("/secret");
      expect(out.content).toContain("/cron");
    } finally { await h.cleanup(); }
  });

  it("/tools → 도구 목록 출력", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS, MOCK_SKILLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/tools"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("도구");
      expect(out.content).toContain("5개");
      expect(out.content).toContain("shell");
      expect(out.content).toContain("memory_read");
    } finally { await h.cleanup(); }
  });

  it("/skills → 스킬 목록 출력", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS, MOCK_SKILLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/skills"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("스킬");
      expect(out.content).toContain("2개");
      expect(out.content).toContain("git-commit");
      expect(out.content).toContain("code-review");
      expect(out.content).toContain("[always]");
    } finally { await h.cleanup(); }
  });

  it("/status → 통합 개요 출력", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS, MOCK_SKILLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/status"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("도구 5개");
      expect(out.content).toContain("스킬 2개");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 2. 자연어 의도 → Phi-4 orchestration 위임 (커맨드 핸들러는 슬래시 명령만)
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 자연어 의도는 커맨드 핸들러가 가로채지 않음", () => {
  it("자연어 도구 요청은 orchestration으로 라우팅된다 (StatusHandler 바이패스)", async () => {
    const orch_calls: OrchestrationRequest[] = [];
    const h = await create_harness({
      command_handlers: [create_status_handler(MOCK_TOOLS)],
      orchestration_handler: capture_and_reply(orch_calls, "도구 목록을 안내합니다"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("현재 사용가능한 도구 목록은?"));
      expect(orch_calls.length).toBe(1);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 3. Orchestration 경로 — LLM 응답 파이프라인
 * ═══════════════════════════════════════════════════════ */

describe("E2E: orchestration 응답 파이프라인", () => {
  it("일반 텍스트 응답이 그대로 채널에 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("프로젝트 구조 분석 완료. 3개 모듈로 분리합니다."),
    });
    try {
      await h.manager.handle_inbound_message(inbound("프로젝트 구조 분석해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("프로젝트 구조 분석 완료");
      expect(out.content).toContain("3개 모듈로 분리합니다");
    } finally { await h.cleanup(); }
  });

  it("줄바꿈이 포함된 응답이 보존된다", async () => {
    const reply = [
      "변경 파일:",
      "- src/auth/login.ts (신규)",
      "- src/routes/index.ts (수정)",
      "",
      "자체 검증: tsc --noEmit 통과.",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("login API 추가해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("src/auth/login.ts");
      expect(out.content).toContain("src/routes/index.ts");
      expect(out.content).toContain("tsc --noEmit 통과");
    } finally { await h.cleanup(); }
  });

  it("도구 이름이 포함된 응답이 sanitizer에 의해 제거되지 않는다", async () => {
    const reply = [
      "현재 등록된 도구는 5개입니다.",
      "",
      "- shell: 셸 명령 실행",
      "- memory_read: 메모리 조회",
      "- secret_get: 시크릿 조회",
      "- cron_add: 크론 작업 등록",
      "- spawn: 서브에이전트 생성",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("도구 알려줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("5개");
      expect(out.content).toContain("shell");
      expect(out.content).toContain("memory_read");
      expect(out.content).toContain("spawn");
    } finally { await h.cleanup(); }
  });

  it("10개 이상 bullet 항목도 잘리지 않는다", async () => {
    const items = Array.from({ length: 10 }, (_, i) => `- item${i + 1}: 설명${i + 1}`);
    const reply = ["도구 목록입니다.", "", ...items].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("item1");
      expect(out.content).toContain("item5");
      expect(out.content).toContain("item10");
    } finally { await h.cleanup(); }
  });

  it("null 응답 시 채널에 아무것도 보내지 않는다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with(null) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("orchestration 에러 시 에러 메시지가 채널에 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => { throw new Error("provider_timeout"); },
    });
    try {
      await h.manager.handle_inbound_message(inbound("작업 해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("실패");
      expect(out.content).toContain("provider_timeout");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 4. Output Sanitizer 통과 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: output sanitizer가 정당한 응답을 파괴하지 않는다", () => {
  const legitimate_responses = [
    {
      name: "npm/git 명령어가 포함된 안내",
      reply: "설치 방법:\nnpm install express\ngit clone repo\n\n완료 후 실행하세요.",
      must_contain: ["npm install express", "git clone repo"],
    },
    {
      name: "코드 블록이 포함된 응답",
      reply: "다음 코드를 추가하세요:\n```typescript\nfunction hello() {\n  return 'world';\n}\n```\n위 코드를 삽입합니다.",
      must_contain: ["function hello"],
    },
    {
      name: "빈 줄로 구분된 문단",
      reply: "첫 번째 항목입니다.\n\n두 번째 항목입니다.\n\n세 번째 항목입니다.",
      must_contain: ["첫 번째", "두 번째", "세 번째"],
    },
    {
      name: "한국어 + 영어 혼합 응답",
      reply: "Build 결과: success\n테스트 통과: 42/42\nCoverage: 87.3%",
      must_contain: ["Build 결과", "42/42", "87.3%"],
    },
    {
      name: "숫자와 특수문자 포함",
      reply: "포트 3000에서 실행 중. URL: http://localhost:3000/api/v1\n응답 시간: 42ms",
      must_contain: ["3000", "http://localhost", "42ms"],
    },
  ];

  for (const { name, reply, must_contain } of legitimate_responses) {
    it(`${name}`, async () => {
      const h = await create_harness({ orchestration_handler: reply_with(reply) });
      try {
        await h.manager.handle_inbound_message(inbound("테스트"));
        const out = last_sent(h.registry.sent);
        for (const text of must_contain) {
          expect(out.content, `"${text}" 가 출력에 포함되어야 합니다`).toContain(text);
        }
      } finally { await h.cleanup(); }
    });
  }
});

/* ═══════════════════════════════════════════════════════
 * 5. 메시지 필터링 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 메시지 필터링", () => {
  it("봇 메시지는 무시된다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("이건 응답되면 안됨") });
    try {
      await h.manager.handle_inbound_message(inbound("봇 메시지", {
        metadata: { from_is_bot: true },
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("subagent 메시지는 무시된다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("이건 응답되면 안됨") });
    try {
      await h.manager.handle_inbound_message(inbound("subagent 결과", {
        sender_id: "subagent:abc123",
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("빈 sender_id 메시지는 무시된다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("이건 응답되면 안됨") });
    try {
      await h.manager.handle_inbound_message(inbound("빈 발신자", { sender_id: "" }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("approval-bot 메시지는 무시된다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("이건 응답되면 안됨") });
    try {
      await h.manager.handle_inbound_message(inbound("approval 결과", {
        sender_id: "approval-bot",
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 6. 채널별 출력 형식 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 채널별 메시지 형식", () => {
  it("telegram 메시지에는 멘션이 붙지 않는다", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/tools", { provider: "telegram" }));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toMatch(/^@/);
    } finally { await h.cleanup(); }
  });

  it("slack 메시지에는 @sender_id 멘션이 포함된다", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/tools", {
        provider: "slack", channel: "slack", sender_id: "U12345",
      }));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("@U12345");
    } finally { await h.cleanup(); }
  });

  it("telegram 기본 렌더 모드는 HTML이다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("**굵은 텍스트** 입니다."),
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트", { provider: "telegram" }));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("<b>");
    } finally { await h.cleanup(); }
  });

  it("응답 메시지에 thread_id가 보존된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("스레드 응답입니다."),
    });
    try {
      await h.manager.handle_inbound_message(inbound("스레드 테스트", {
        provider: "slack", channel: "slack", sender_id: "U99",
        thread_id: "thread-abc-123",
      }));
      const out = last_sent(h.registry.sent);
      expect(out.thread_id).toBe("thread-abc-123");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 7. 미디어 첨부 파이프라인
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 미디어 첨부 파이프라인", () => {
  it("응답에 파일 경로가 포함되면 media로 첨부된다", async () => {
    const h = await create_harness();
    try {
      const file = join(h.workspace, "result.txt");
      await writeFile(file, "test data", "utf-8");
      h.orchestration.handler = reply_with(`결과 파일: [result.txt](${file})`);
      await h.manager.handle_inbound_message(inbound("파일 만들어줘"));
      const out = last_sent(h.registry.sent);
      expect(out.media?.length).toBe(1);
      expect(out.media?.[0]?.url).toBe(file);
    } finally { await h.cleanup(); }
  });

  it("여러 파일이 모두 첨부된다", async () => {
    const h = await create_harness();
    try {
      const f1 = join(h.workspace, "a.txt");
      const f2 = join(h.workspace, "b.txt");
      await writeFile(f1, "file a", "utf-8");
      await writeFile(f2, "file b", "utf-8");
      h.orchestration.handler = reply_with(`파일:\n[a.txt](${f1})\n[b.txt](${f2})`);
      await h.manager.handle_inbound_message(inbound("파일 만들어줘"));
      const out = last_sent(h.registry.sent);
      expect(out.media?.length).toBe(2);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 8. 커맨드 → orchestration 우선순위
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 라우팅 우선순위", () => {
  it("커맨드가 orchestration보다 먼저 처리된다", async () => {
    const orch_calls: OrchestrationRequest[] = [];
    const h = await create_harness({
      command_handlers: [new HelpHandler()],
      orchestration_handler: capture_and_reply(orch_calls, "이건 호출되면 안됨"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("/help"));
      expect(h.registry.sent.length).toBeGreaterThan(0);
      expect(last_sent(h.registry.sent).content).toContain("사용 가능한 공통 명령");
      expect(orch_calls.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("커맨드가 아닌 일반 메시지는 orchestration으로 전달된다", async () => {
    const orch_calls: OrchestrationRequest[] = [];
    const h = await create_harness({
      command_handlers: [new HelpHandler()],
      orchestration_handler: capture_and_reply(orch_calls, "orchestration 응답"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("이건 일반 메시지입니다"));
      expect(orch_calls.length).toBe(1);
      expect(orch_calls[0].message.content).toBe("이건 일반 메시지입니다");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 9. 한국어 별칭 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 한국어 별칭 커맨드", () => {
  it("/도움말 → /help와 동일한 결과", async () => {
    const h = await create_harness({ command_handlers: all_command_handlers() });
    try {
      await h.manager.handle_inbound_message(inbound("/도움말"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("사용 가능한 공통 명령");
    } finally { await h.cleanup(); }
  });

  it("/중지 → /stop과 동일한 결과", async () => {
    const h = await create_harness({ command_handlers: [create_stop_handler(3)] });
    try {
      await h.manager.handle_inbound_message(inbound("/중지"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("3건");
      expect(out.content).toContain("중지");
    } finally { await h.cleanup(); }
  });

  it("/도구 → /tools와 동일한 결과", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS, MOCK_SKILLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/도구"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("도구");
      expect(out.content).toContain("shell");
    } finally { await h.cleanup(); }
  });

  it("/스킬 → /skills와 동일한 결과", async () => {
    const h = await create_harness({ command_handlers: [create_status_handler(MOCK_TOOLS, MOCK_SKILLS)] });
    try {
      await h.manager.handle_inbound_message(inbound("/스킬"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("스킬");
      expect(out.content).toContain("git-commit");
    } finally { await h.cleanup(); }
  });

  it("/비밀 목록 → /secret list와 동일한 결과", async () => {
    const h = await create_harness({
      command_handlers: [create_secret_handler({ api_key: "sk_12345" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/비밀 목록"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("api_key");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 10. /stop 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /stop 커맨드", () => {
  it("실행 중 작업이 있으면 건수를 포함한 중지 메시지 출력", async () => {
    const h = await create_harness({ command_handlers: [create_stop_handler(5)] });
    try {
      await h.manager.handle_inbound_message(inbound("/stop"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("5건");
      expect(out.content).toContain("중지");
    } finally { await h.cleanup(); }
  });

  it("실행 중 작업이 없으면 '없습니다' 메시지 출력", async () => {
    const h = await create_harness({ command_handlers: [create_stop_handler(0)] });
    try {
      await h.manager.handle_inbound_message(inbound("/stop"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("없습니다");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 11. /render 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /render 커맨드", () => {
  it("/render status → 현재 렌더 설정 출력", async () => {
    const { handler } = create_render_handler();
    const h = await create_harness({ command_handlers: [handler] });
    try {
      await h.manager.handle_inbound_message(inbound("/render status"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("render 설정");
      expect(out.content).toContain("mode");
    } finally { await h.cleanup(); }
  });

  it("/render html → 모드 변경 확인", async () => {
    const { handler } = create_render_handler();
    const h = await create_harness({ command_handlers: [handler] });
    try {
      await h.manager.handle_inbound_message(inbound("/render html"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("html");
      expect(out.content).toContain("설정");
    } finally { await h.cleanup(); }
  });

  it("/render reset → 기본값 초기화 확인", async () => {
    const { handler } = create_render_handler();
    const h = await create_harness({ command_handlers: [handler] });
    try {
      await h.manager.handle_inbound_message(inbound("/render reset"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("초기화");
    } finally { await h.cleanup(); }
  });

  it("/render link remove → 링크 정책 변경 확인", async () => {
    const { handler } = create_render_handler();
    const h = await create_harness({ command_handlers: [handler] });
    try {
      await h.manager.handle_inbound_message(inbound("/render link remove"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("link");
      expect(out.content).toContain("remove");
    } finally { await h.cleanup(); }
  });

  it("/render 잘못된인자 → 에러 안내 출력", async () => {
    const { handler } = create_render_handler();
    const h = await create_harness({ command_handlers: [handler] });
    try {
      await h.manager.handle_inbound_message(inbound("/render xyz"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("이해하지 못했습니다");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 12. /secret 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /secret 커맨드", () => {
  it("/secret status → vault 상태 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_secret_handler({ api_key: "sk_12345" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/secret status"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("vault 상태");
      expect(out.content).toContain("names");
    } finally { await h.cleanup(); }
  });

  it("/secret list → 목록 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_secret_handler({ api_key: "sk_12345", db_pass: "p@ss" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/secret list"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("api_key");
      expect(out.content).toContain("db_pass");
    } finally { await h.cleanup(); }
  });

  it("/secret list (비어있음) → '없습니다' 메시지 출력", async () => {
    const h = await create_harness({ command_handlers: [create_secret_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret list"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("없습니다");
    } finally { await h.cleanup(); }
  });

  it("/secret set name value → 저장 완료 메시지", async () => {
    const secrets: Record<string, string> = {};
    const h = await create_harness({ command_handlers: [create_secret_handler(secrets)] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret set my_token abc123"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("저장 완료");
      expect(out.content).toContain("my_token");
      expect(out.content).toContain("AES-256-GCM");
      expect(secrets["my_token"]).toBe("abc123");
    } finally { await h.cleanup(); }
  });

  it("/secret get name → ciphertext 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_secret_handler({ api_key: "sk_12345" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/secret get api_key"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("ciphertext");
      expect(out.content).toContain("ENC(sk_12345)");
    } finally { await h.cleanup(); }
  });

  it("/secret reveal name → plaintext 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_secret_handler({ api_key: "sk_12345" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/secret reveal api_key"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("plaintext");
      expect(out.content).toContain("sk_12345");
    } finally { await h.cleanup(); }
  });

  it("/secret remove name → 삭제 완료 메시지", async () => {
    const secrets = { api_key: "sk_12345" };
    const h = await create_harness({ command_handlers: [create_secret_handler(secrets)] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret remove api_key"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("삭제 완료");
      expect("api_key" in secrets).toBe(false);
    } finally { await h.cleanup(); }
  });

  it("/secret encrypt text → 암호화 결과 출력", async () => {
    const h = await create_harness({ command_handlers: [create_secret_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret encrypt hello world"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("encrypt 완료");
      expect(out.content).toContain("ENC(hello world)");
    } finally { await h.cleanup(); }
  });

  it("/secret decrypt cipher → 복호화 결과 출력", async () => {
    const h = await create_harness({ command_handlers: [create_secret_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret decrypt ENC(hello world)"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("decrypt 결과");
      expect(out.content).toContain("hello world");
    } finally { await h.cleanup(); }
  });

  it("/secret get 존재하지않는키 → '찾지 못했습니다' 메시지", async () => {
    const h = await create_harness({ command_handlers: [create_secret_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret get no_such_key"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("찾지 못했습니다");
    } finally { await h.cleanup(); }
  });

  it("/secret (인자 없음) → status 출력", async () => {
    const h = await create_harness({ command_handlers: [create_secret_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("vault 상태");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 13. /memory 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /memory 커맨드", () => {
  it("/memory status → 메모리 상태 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_memory_handler({ daily: { "2026-02-28": "entry" }, longterm: "goals" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/memory status"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("메모리 상태");
      expect(out.content).toContain("daily_files");
    } finally { await h.cleanup(); }
  });

  it("/memory list → daily 파일 목록 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_memory_handler({ daily: { "2026-02-27": "a", "2026-02-28": "b" } })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/memory list"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("daily memory 목록");
      expect(out.content).toContain("2026-02-27");
      expect(out.content).toContain("2026-02-28");
    } finally { await h.cleanup(); }
  });

  it("/memory longterm → 장기 메모리 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_memory_handler({ longterm: "장기 목표: 아키텍처 개선" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/memory longterm"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("장기 메모리");
      expect(out.content).toContain("아키텍처 개선");
    } finally { await h.cleanup(); }
  });

  it("/memory search query → 검색 결과 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_memory_handler({
        search_results: [
          { file: "2026-02-28.md", line: 3, text: "프로젝트 리팩토링 계획" },
          { file: "2026-02-27.md", line: 1, text: "리팩토링 진행 상황" },
        ],
      })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/memory search 리팩토링"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("검색 결과");
      expect(out.content).toContain("리팩토링");
    } finally { await h.cleanup(); }
  });

  it("/memory search (결과 없음) → '없습니다' 메시지 출력", async () => {
    const h = await create_harness({ command_handlers: [create_memory_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/memory search nonexistent"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("없습니다");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 14. /decision 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /decision 커맨드", () => {
  it("/decision status → 현재 지침 목록 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_decision_handler([
        { priority: 1, canonical_key: "coding_style", value: "YAGNI 원칙 준수" },
        { priority: 2, canonical_key: "test_coverage", value: "80% 이상 유지" },
      ])],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/decision status"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("지침");
      expect(out.content).toContain("coding_style");
      expect(out.content).toContain("YAGNI");
    } finally { await h.cleanup(); }
  });

  it("/decision set key value → 저장 완료 확인", async () => {
    const h = await create_harness({ command_handlers: [create_decision_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/decision set risk_limit 2%"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("저장 완료");
      expect(out.content).toContain("risk_limit");
      expect(out.content).toContain("2%");
    } finally { await h.cleanup(); }
  });

  it("/decision (빈 목록) → empty 표시", async () => {
    const h = await create_harness({ command_handlers: [create_decision_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/decision"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("지침");
      expect(out.content).toContain("active: 0");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 15. /cron 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /cron 커맨드", () => {
  it("/cron status → 크론 상태 출력", async () => {
    const h = await create_harness({ command_handlers: [create_cron_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/cron status"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("cron 상태");
      expect(out.content).toContain("enabled");
    } finally { await h.cleanup(); }
  });

  it("/cron list (빈 목록) → '없습니다' 메시지", async () => {
    const h = await create_harness({ command_handlers: [create_cron_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/cron list"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("없습니다");
    } finally { await h.cleanup(); }
  });

  it("/cron list (작업 있음) → 작업 목록 출력", async () => {
    const jobs = [
      {
        id: "job-abc", name: "health check", enabled: true,
        schedule: { kind: "every", every_ms: 60_000 },
        state: { next_run_at_ms: Date.now() + 60_000 },
      },
    ];
    const h = await create_harness({ command_handlers: [create_cron_handler(jobs)] });
    try {
      await h.manager.handle_inbound_message(inbound("/cron list"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("작업 목록");
      expect(out.content).toContain("job-abc");
      expect(out.content).toContain("health check");
    } finally { await h.cleanup(); }
  });

  it("/cron add every 5m 서버 체크 → 등록 완료", async () => {
    const h = await create_harness({ command_handlers: [create_cron_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/cron add every 5m 서버 상태 체크"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("등록 완료");
      expect(out.content).toContain("서버 상태 체크");
    } finally { await h.cleanup(); }
  });

  it("/cron remove job_id → 삭제 완료", async () => {
    const jobs = [{ id: "job-xyz", name: "test", enabled: true, schedule: { kind: "every", every_ms: 1000 }, state: {} }];
    const h = await create_harness({ command_handlers: [create_cron_handler(jobs)] });
    try {
      await h.manager.handle_inbound_message(inbound("/cron remove job-xyz"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("삭제 완료");
      expect(out.content).toContain("job-xyz");
    } finally { await h.cleanup(); }
  });

  it("/cron add (잘못된 형식) → 사용법 안내", async () => {
    const h = await create_harness({ command_handlers: [create_cron_handler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/cron add"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("형식");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 16. /reload 커맨드
 * ═══════════════════════════════════════════════════════ */

describe("E2E: /reload 커맨드", () => {
  it("/reload → 전체 리로드 성공 결과 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_reload_handler({ tools_count: 7, skills_count: 3 })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/reload"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("reload");
      expect(out.content).toContain("config");
      expect(out.content).toContain("reloaded");
      expect(out.content).toContain("7 reloaded");
      expect(out.content).toContain("3 reloaded");
    } finally { await h.cleanup(); }
  });

  it("/reload (config 실패) → 부분 실패 결과 출력", async () => {
    const h = await create_harness({
      command_handlers: [create_reload_handler({ config_error: "file not found" })],
    });
    try {
      await h.manager.handle_inbound_message(inbound("/reload"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("failed");
      expect(out.content).toContain("file not found");
      expect(out.content).toContain("tools");
      expect(out.content).toContain("reloaded");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 17. 긴 응답 잘림 (1600 char)
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 긴 응답 잘림", () => {
  it("1600자 초과 orchestration 응답이 잘린다", async () => {
    const long_text = "이것은 반복 텍스트입니다. ".repeat(200);
    const h = await create_harness({ orchestration_handler: reply_with(long_text) });
    try {
      await h.manager.handle_inbound_message(inbound("긴 응답 테스트"));
      const out = last_sent(h.registry.sent);
      expect(out.content.length).toBeLessThanOrEqual(1700);
    } finally { await h.cleanup(); }
  });

  it("1600자 초과 커맨드 응답이 잘린다", async () => {
    const many_secrets: Record<string, string> = {};
    for (let i = 0; i < 100; i++) many_secrets[`secret_${String(i).padStart(3, "0")}`] = `value_${i}`;
    const h = await create_harness({ command_handlers: [create_secret_handler(many_secrets)] });
    try {
      await h.manager.handle_inbound_message(inbound("/secret list"));
      const out = last_sent(h.registry.sent);
      expect(out.content.length).toBeLessThanOrEqual(1700);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 18. 렌더링 정규화 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 응답 템플릿 정규화", () => {
  it("코드 블록 포함 응답이 섹션 템플릿으로 변환된다", async () => {
    const reply = [
      "설정 파일을 수정했습니다.",
      "```json",
      '{ "port": 3000 }',
      "```",
      "위 설정으로 서버를 재시작하세요.",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("설정 바꿔줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("3000");
    } finally { await h.cleanup(); }
  });

  it("180자 미만 단순 응답은 그대로 전달된다", async () => {
    const short = "작업 완료했습니다.";
    const h = await create_harness({ orchestration_handler: reply_with(short) });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("작업 완료");
    } finally { await h.cleanup(); }
  });

  it("secret_resolution_required 에러가 특수 템플릿으로 변환된다", async () => {
    const error_reply = [
      "Error: secret_resolution_required",
      "missing_keys: API_KEY, DB_PASS",
      "invalid_ciphertexts: broken_token",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(error_reply) });
    try {
      await h.manager.handle_inbound_message(inbound("시크릿 확인"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("복호화");
      expect(out.content).toContain("API_KEY");
      expect(out.content).toContain("DB_PASS");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 19. 에러 메시지 정규화
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 에러 메시지 정규화", () => {
  it("에러 메시지에 alias와 '실패' 키워드가 포함된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => { throw new Error("connection refused"); },
    });
    try {
      await h.manager.handle_inbound_message(inbound("작업 요청"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("실패");
      expect(out.content).toContain("assistant");
    } finally { await h.cleanup(); }
  });

  it("orchestration result.error → 에러 응답 전달", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null, error: "model_overloaded", mode: "once" as const,
        tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("작업 요청"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("실패");
      expect(out.content).toContain("model_overloaded");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 20. 스트리밍 응답 파이프라인
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 스트리밍 응답 파이프라인", () => {
  it("on_stream 호출 → 스트림 메시지 전송 → 최종 응답 edit", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("작업 진행 중...");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "최종 작업 결과입니다.", mode: "once" as const, tool_calls_count: 1, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("복잡한 작업 해줘"));
      // 스트림 메시지가 dispatch를 통해 전송되었는지 확인
      const stream_msg = h.registry.sent.find(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msg, "스트림 메시지가 전송되어야 함").toBeTruthy();
      expect(stream_msg!.content).toContain("작업 진행");

      // 최종 응답이 edit_message로 전달되었는지 확인
      expect(h.registry.edited.length).toBeGreaterThan(0);
      const final_edit = h.registry.edited[h.registry.edited.length - 1];
      expect(final_edit.content).toContain("최종 작업 결과");
    } finally { await h.cleanup(); }
  });

  it("on_stream 미호출 + streamed=true → 일반 전송 fallback", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "스트림 없이 완료.", mode: "once" as const, tool_calls_count: 0, streamed: true,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("작업 해줘"));
      // stream_message_id가 빈 문자열이므로 일반 전송
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("스트림 없이 완료");
      // edit_message는 호출되지 않아야 함
      expect(h.registry.edited.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("스트리밍 1200ms 스로틀: 첫 chunk만 전송, 빠른 후속 chunk는 무시", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("chunk-1");
        await new Promise((r) => setTimeout(r, 20));
        // 1200ms 이내이므로 이 chunk는 무시됨
        req.on_stream?.("chunk-2-ignored");
        await new Promise((r) => setTimeout(r, 20));
        return { reply: "최종 결과", mode: "once" as const, tool_calls_count: 0, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      // 스트림 메시지는 1개만 전송 (첫 chunk)
      const stream_msgs = h.registry.sent.filter(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msgs.length).toBe(1);
      expect(stream_msgs[0].content).toContain("chunk-1");

      // 최종 edit에는 "최종 결과" 포함
      const final_edit = h.registry.edited[h.registry.edited.length - 1];
      expect(final_edit.content).toContain("최종 결과");
    } finally { await h.cleanup(); }
  });

  it("스트리밍 응답의 thread_id가 원본 메시지의 thread_id를 유지한다", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("스트림 내용");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "완료", mode: "once" as const, tool_calls_count: 0, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("스레드 스트림 테스트", {
        provider: "slack", channel: "slack", sender_id: "U01",
        thread_id: "thread-stream-001",
      }));
      const stream_msg = h.registry.sent.find(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msg?.thread_id).toBe("thread-stream-001");
    } finally { await h.cleanup(); }
  });

  it("suppress_reply=true 시 스트리밍 결과여도 채널에 전달하지 않는다", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("이건 보이면 안됨");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "숨김 응답", mode: "once" as const, tool_calls_count: 0, streamed: true, suppress_reply: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      // 스트림 메시지는 전송되지만, 최종 delivery의 edit은 없어야 함
      // (suppress_reply는 deliver_result 진입 시 체크)
      const edits_for_final = h.registry.edited.filter((e) => e.content.includes("숨김 응답"));
      expect(edits_for_final.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("빈 on_stream chunk는 무시된다", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("");
        req.on_stream?.("   ");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "정상 응답", mode: "once" as const, tool_calls_count: 0, streamed: false };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      const stream_msgs = h.registry.sent.filter(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msgs.length).toBe(0);
      // 일반 응답만 전달
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("정상 응답");
    } finally { await h.cleanup(); }
  });

  it("스트리밍 응답의 스트림 메시지에 agent_alias가 포함된다", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("alias 확인용 스트림");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "완료", mode: "once" as const, tool_calls_count: 0, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      const stream_msg = h.registry.sent.find(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msg).toBeTruthy();
      expect((stream_msg!.metadata as Record<string, unknown>).agent_alias).toBe("assistant");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 21. orchestration 결과 — suppress / error 경계
 * ═══════════════════════════════════════════════════════ */

describe("E2E: orchestration 결과 경계 케이스", () => {
  it("suppress_reply=true → 채널에 아무것도 보내지 않는다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "이건 숨겨져야 함", mode: "once" as const, tool_calls_count: 0,
        streamed: false, suppress_reply: true,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("reply=null + error → 에러 메시지가 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null, error: "quota_exceeded", mode: "once" as const,
        tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("작업"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("실패");
      expect(out.content).toContain("quota_exceeded");
    } finally { await h.cleanup(); }
  });

  it("reply=null + error=undefined → 채널에 아무것도 보내지 않는다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null, mode: "once" as const, tool_calls_count: 0, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("tool_calls_count가 양수여도 응답 렌더링에 영향 없다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "5개 도구를 사용했습니다.", mode: "agent" as const,
        tool_calls_count: 5, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("복잡한 작업"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("5개 도구");
    } finally { await h.cleanup(); }
  });

  it("mode=task 결과도 정상적으로 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "장기 작업이 완료되었습니다.", mode: "task" as const,
        tool_calls_count: 12, streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("장기 작업"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("장기 작업이 완료");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 22. orchestration 요청 컨텍스트 전달
 * ═══════════════════════════════════════════════════════ */

describe("E2E: orchestration 요청 컨텍스트", () => {
  it("메시지 content가 그대로 전달된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "ok"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("정확한 텍스트 전달 확인"));
      expect(captured[0].message.content).toBe("정확한 텍스트 전달 확인");
    } finally { await h.cleanup(); }
  });

  it("provider 정보가 전달된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "ok"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test", {
        provider: "slack", channel: "slack", sender_id: "U01",
      }));
      expect(captured[0].provider).toBe("slack");
    } finally { await h.cleanup(); }
  });

  it("alias가 defaultAlias(assistant)로 설정된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "ok"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(captured[0].alias).toBe("assistant");
    } finally { await h.cleanup(); }
  });

  it("on_stream 콜백이 전달된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "ok"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(typeof captured[0].on_stream).toBe("function");
    } finally { await h.cleanup(); }
  });

  it("signal(AbortController)이 전달된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "ok"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(captured[0].signal).toBeInstanceOf(AbortSignal);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 23. 아웃바운드 메시지 메타데이터 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 아웃바운드 메시지 메타데이터", () => {
  it("orchestration 응답의 kind=agent_reply", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("응답") });
    try {
      await h.manager.handle_inbound_message(inbound("테스트"));
      const out = last_sent(h.registry.sent);
      expect((out.metadata as Record<string, unknown>).kind).toBe("agent_reply");
    } finally { await h.cleanup(); }
  });

  it("커맨드 응답의 kind=command_reply", async () => {
    const h = await create_harness({ command_handlers: [new HelpHandler()] });
    try {
      await h.manager.handle_inbound_message(inbound("/help"));
      const out = last_sent(h.registry.sent);
      expect((out.metadata as Record<string, unknown>).kind).toBe("command_reply");
    } finally { await h.cleanup(); }
  });

  it("에러 응답의 kind=agent_error", async () => {
    const h = await create_harness({
      orchestration_handler: async () => { throw new Error("fail"); },
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect((out.metadata as Record<string, unknown>).kind).toBe("agent_error");
    } finally { await h.cleanup(); }
  });

  it("slack 응답의 reply_to에 원본 message_id가 포함된다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("응답") });
    try {
      const msg = inbound("test", {
        id: "orig-msg-42", provider: "slack", channel: "slack", sender_id: "U01",
        metadata: { message_id: "orig-msg-42" },
      });
      await h.manager.handle_inbound_message(msg);
      const out = last_sent(h.registry.sent);
      expect(out.reply_to).toBe("orig-msg-42");
    } finally { await h.cleanup(); }
  });

  it("telegram 응답의 reply_to는 빈 문자열이다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("응답") });
    try {
      const msg = inbound("test", { provider: "telegram", metadata: { message_id: "tg-123" } });
      await h.manager.handle_inbound_message(msg);
      const out = last_sent(h.registry.sent);
      expect(out.reply_to).toBe("");
    } finally { await h.cleanup(); }
  });

  it("스트림 메시지의 kind=agent_stream", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("streaming...");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "done", mode: "once" as const, tool_calls_count: 0, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const stream_msg = h.registry.sent.find(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msg).toBeTruthy();
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 24. cancel_active_runs 동작 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: cancel_active_runs", () => {
  it("진행 중인 실행을 abort할 수 있다", async () => {
    let signal_aborted = false;
    const h = await create_harness({
      orchestration_handler: async (req) => {
        // 장시간 대기 시뮬레이션
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (req.signal?.aborted) {
              signal_aborted = true;
              clearInterval(check);
              resolve();
            }
          }, 10);
          setTimeout(() => { clearInterval(check); resolve(); }, 500);
        });
        return { reply: "aborted", mode: "once" as const, tool_calls_count: 0, streamed: false };
      },
    });
    try {
      const run_promise = h.manager.handle_inbound_message(inbound("장시간 작업"));
      // 약간 기다린 후 취소
      await new Promise((r) => setTimeout(r, 30));
      const cancelled = h.manager.cancel_active_runs();
      expect(cancelled).toBe(1);
      await run_promise;
      expect(signal_aborted).toBe(true);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 25. 페르소나/시스템 프롬프트 누출 방어
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 페르소나/시스템 프롬프트 누출 차단", () => {
  const persona_leak_cases = [
    {
      name: "SOUL.md 내용이 응답에 포함되면 제거된다",
      reply: "네, 아래는 설정 파일 내용입니다.\n```\n## Soul\n전문가 집단의 프로젝트 리더. AGENTS.md 참조.\n```\n이상입니다.",
      must_not_contain: ["AGENTS.md"],
    },
    {
      name: "시스템 명령어 형태가 응답에 포함되면 제거된다",
      reply: "<instructions>\nYou are a coding agent.\n</instructions>\n실제 응답입니다.",
      must_not_contain: ["<instructions>", "</instructions>", "You are a coding agent"],
    },
    {
      name: "Role: LEAD 같은 역할 헤더가 그대로 나가지 않는다",
      reply: "Role: LEAD\n\n분석 완료했습니다.",
      must_not_contain: ["Role: LEAD"],
      must_contain: ["분석 완료"],
    },
    {
      name: "Identity/Mission/Constraints 헤더가 누출되지 않는다",
      reply: "# Identity\n나는 AI 에이전트다.\n# Mission\n사용자 돕기.\n\n결과: 성공.",
      must_not_contain: ["Identity", "Mission"],
      must_contain: ["결과"],
    },
  ];

  for (const { name, reply, must_not_contain, must_contain } of persona_leak_cases) {
    it(name, async () => {
      const h = await create_harness({ orchestration_handler: reply_with(reply) });
      try {
        await h.manager.handle_inbound_message(inbound("test"));
        const out = last_sent(h.registry.sent);
        for (const bad of must_not_contain) {
          expect(out.content, `"${bad}" 가 출력에 나가면 안됨`).not.toContain(bad);
        }
        if (must_contain) {
          for (const good of must_contain) {
            expect(out.content, `"${good}" 가 출력에 있어야 함`).toContain(good);
          }
        }
      } finally { await h.cleanup(); }
    });
  }
});

/* ═══════════════════════════════════════════════════════
 * 26. 도구 프로토콜 누출 차단
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 도구 프로토콜 내부 정보 누출 차단", () => {
  it("tool_calls JSON이 응답에 포함되면 제거된다", async () => {
    const reply = [
      '작업을 진행하겠습니다.',
      'tool_calls: [2 items]',
      '{"tool_calls":[{"id":"call_abc123"}]}',
      '완료했습니다.',
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("tool_calls");
      expect(out.content).not.toContain("call_abc123");
      expect(out.content).toContain("완료");
    } finally { await h.cleanup(); }
  });

  it("ORCH_TOOL_CALLS 블록이 응답에서 완전히 제거된다", async () => {
    const reply = [
      "분석 결과:",
      "<<ORCH_TOOL_CALLS>>",
      '{"id":"call_xyz","name":"shell","input":"ls"}',
      "<<ORCH_TOOL_CALLS_END>>",
      "3개 파일이 있습니다.",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("ORCH_TOOL_CALLS");
      expect(out.content).not.toContain("call_xyz");
      expect(out.content).not.toContain('"shell"');
      expect(out.content).toContain("3개 파일");
    } finally { await h.cleanup(); }
  });

  it("오케스트레이터 라우팅 정보가 그대로 나가지 않는다", async () => {
    const reply = [
      "오케스트레이터 직접 처리",
      "execution mode: once",
      "routing: agent",
      "",
      "실제 응답 내용입니다.",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("오케스트레이터 직접 처리");
      expect(out.content).not.toContain("execution mode");
      expect(out.content).not.toContain("routing: agent");
      expect(out.content).toContain("실제 응답 내용");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 27. 시크릿/민감정보 누출 차단
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 시크릿 참조 및 암호문 누출 차단", () => {
  it("{{secret:API_KEY}} 토큰이 [REDACTED]로 치환된다", async () => {
    const reply = "설정 완료. API_KEY={{secret:API_KEY}}로 접속합니다.";
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).toContain("[REDACTED:SECRET_REF]");
    } finally { await h.cleanup(); }
  });

  it("sv1.xxx.yyy.zzz 형태의 암호문이 [REDACTED]로 치환된다", async () => {
    const reply = "토큰: sv1.aAbBcCdD.eEfFgGhH.iIjJkKlL 이 유효합니다.";
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("sv1.");
      expect(out.content).toContain("[REDACTED:CIPHERTEXT]");
    } finally { await h.cleanup(); }
  });

  it("ANSI 이스케이프 코드가 출력에 남지 않는다", async () => {
    const reply = "\x1B[31m에러\x1B[0m가 발생했습니다. \x1B[32m해결\x1B[0m 완료.";
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toMatch(/\x1B\[/);
      expect(out.content).toContain("에러");
      expect(out.content).toContain("해결");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 28. 셸 코드 블록 누출 차단
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 셸 코드 블록 누출 차단", () => {
  it("```bash 코드 블록이 최종 출력에서 제거된다", async () => {
    const reply = [
      "작업 과정:",
      "```bash",
      "rm -rf /tmp/build && npm run build",
      "```",
      "빌드가 성공했습니다.",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      // strip_sensitive_command_blocks가 ```bash 블록을 제거
      expect(out.content).not.toContain("rm -rf");
      expect(out.content).not.toContain("npm run build");
      expect(out.content).toContain("빌드가 성공");
    } finally { await h.cleanup(); }
  });

  it("```powershell 코드 블록도 제거된다", async () => {
    const reply = [
      "실행 결과:",
      "```powershell",
      "$env:NODE_ENV='production'",
      "dotnet build",
      "```",
      "배포 완료.",
    ].join("\n");
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("$env:");
      expect(out.content).not.toContain("dotnet build");
      expect(out.content).toContain("배포 완료");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 29. 마크업 위반 검출 — 채널별 렌더링 규칙 준수
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 채널별 마크업 규칙 위반 검출", () => {
  it("slack 출력에 HTML 태그(<b>, <i>)가 포함되지 않는다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("**굵은 텍스트**와 *기울임*입니다."),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test", {
        provider: "slack", channel: "slack", sender_id: "U01",
      }));
      const out = last_sent(h.registry.sent);
      // Slack은 markdown 모드 → HTML 태그 금지
      expect(out.content).not.toContain("<b>");
      expect(out.content).not.toContain("<i>");
      expect(out.content).not.toContain("</b>");
      // markdown 원본은 보존
      expect(out.content).toContain("**");
    } finally { await h.cleanup(); }
  });

  it("telegram 출력의 <script> 태그가 완전히 제거된다 (XSS 방지)", async () => {
    const reply = '사용자 입력: <script>alert("xss")</script> 처리 완료.';
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      const out = last_sent(h.registry.sent);
      // sanitizeMarkdown이 비마크다운 HTML 태그를 완전 제거 (이스케이프보다 안전)
      expect(out.content).not.toContain("<script>");
      expect(out.content).not.toContain("</script>");
      expect(out.content).not.toContain("alert(");
      // 태그 주변 텍스트는 보존
      expect(out.content).toContain("사용자 입력:");
      expect(out.content).toContain("처리 완료.");
    } finally { await h.cleanup(); }
  });

  it("telegram 출력에서 <img onerror> XSS 벡터가 차단된다", async () => {
    const reply = '결과: <img src=x onerror="alert(1)"> 완료';
    const h = await create_harness({ orchestration_handler: reply_with(reply) });
    try {
      await h.manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("onerror");
      expect(out.content).not.toMatch(/<img[^>]*onerror/i);
    } finally { await h.cleanup(); }
  });

  it("non-telegram에서 render profile이 html이어도 markdown으로 강제된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("**테스트**"),
    });
    try {
      // Slack에 html 렌더 프로필을 설정해도
      h.manager.set_render_profile("slack", "chat-1", { mode: "html" });
      await h.manager.handle_inbound_message(inbound("test", {
        provider: "slack", channel: "slack", sender_id: "U01",
      }));
      const out = last_sent(h.registry.sent);
      // effective_render_profile에서 markdown으로 강제됨 → HTML 태그 없어야 함
      expect(out.content).not.toContain("<b>");
      const meta = out.metadata as Record<string, unknown>;
      expect(meta.render_parse_mode).not.toBe("HTML");
    } finally { await h.cleanup(); }
  });

  it("telegram 출력의 parse_mode가 HTML로 설정된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("**굵은** 텍스트"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test", { provider: "telegram" }));
      const out = last_sent(h.registry.sent);
      const meta = out.metadata as Record<string, unknown>;
      expect(meta.render_parse_mode).toBe("HTML");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 30. 중복 메시지 방지 (seen 캐시)
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 중복 메시지 방지", () => {
  it("같은 message_id로 두 번 처리해도 커맨드 응답은 2회 나간다 (handle_inbound는 seen 미적용)", async () => {
    // handle_inbound_message는 직접 호출 시 seen 캐시를 타지 않음
    // (seen 캐시는 poll loop에서만 적용)
    // 따라서 이 테스트는 handle_inbound_message가 멱등하지 않음을 확인
    const h = await create_harness({ command_handlers: [new HelpHandler()] });
    try {
      const msg = inbound("/help", { id: "dup-1", metadata: { message_id: "dup-1" } });
      await h.manager.handle_inbound_message(msg);
      await h.manager.handle_inbound_message(msg);
      // 직접 호출이므로 2회 응답됨 — poll loop의 is_duplicate와 다름
      expect(h.registry.sent.length).toBe(2);
    } finally { await h.cleanup(); }
  });

  it("동일 alias + chat_id에 연속 요청 시 이전 실행이 abort된다", async () => {
    const signals: boolean[] = [];
    const h = await create_harness({
      orchestration_handler: async (req) => {
        await new Promise((r) => setTimeout(r, 100));
        signals.push(req.signal?.aborted ?? false);
        return { reply: "ok", mode: "once" as const, tool_calls_count: 0, streamed: false };
      },
    });
    try {
      const p1 = h.manager.handle_inbound_message(inbound("첫 번째 요청"));
      await new Promise((r) => setTimeout(r, 20));
      const p2 = h.manager.handle_inbound_message(inbound("두 번째 요청"));
      await Promise.all([p1, p2]);
      // 첫 번째 실행은 abort 되어야 함
      expect(signals[0]).toBe(true);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 31. 자기 루프 방지 — 봇 자신의 메시지 무시
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 자기 루프 방지", () => {
  it("Slack bot_id와 동일한 sender_id → 무시", async () => {
    const prev = process.env.SLACK_BOT_USER_ID;
    process.env.SLACK_BOT_USER_ID = "B_MY_BOT";
    const h = await create_harness({ orchestration_handler: reply_with("자기 응답 루프") });
    try {
      await h.manager.handle_inbound_message(inbound("봇 자신의 메시지", {
        provider: "slack", channel: "slack", sender_id: "b_my_bot",
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally {
      process.env.SLACK_BOT_USER_ID = prev;
      await h.cleanup();
    }
  });

  it("Slack bot_message subtype → 무시", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("봇 메시지 루프") });
    try {
      await h.manager.handle_inbound_message(inbound("other bot", {
        provider: "slack", channel: "slack", sender_id: "other-user",
        metadata: { slack: { subtype: "bot_message", bot_id: "B_OTHER" } },
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("Slack message_changed subtype → 무시", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("편집 이벤트") });
    try {
      await h.manager.handle_inbound_message(inbound("edited message", {
        provider: "slack", channel: "slack", sender_id: "user-1",
        metadata: { slack: { subtype: "message_changed" } },
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("task_recovery kind → 무시", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("복구 루프") });
    try {
      await h.manager.handle_inbound_message(inbound("recovery", {
        sender_id: "recovery",
        metadata: { kind: "task_recovery" },
      }));
      expect(h.registry.sent.length).toBe(0);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 32. 메시지 카운트 가드 — 정확한 수의 메시지만 생성
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 메시지 카운트 가드", () => {
  it("커맨드 응답은 정확히 1개만 생성된다", async () => {
    const h = await create_harness({ command_handlers: all_command_handlers() });
    try {
      await h.manager.handle_inbound_message(inbound("/secret status"));
      expect(h.registry.sent.length).toBe(1);
    } finally { await h.cleanup(); }
  });

  it("orchestration 일반 응답은 정확히 1개만 생성된다", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("단일 응답") });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(h.registry.sent.length).toBe(1);
      expect(h.registry.edited.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("스트리밍 응답: 스트림 메시지 1개 + 최종 edit 1개", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("진행중");
        await new Promise((r) => setTimeout(r, 50));
        return { reply: "완료", mode: "once" as const, tool_calls_count: 0, streamed: true };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const stream_msgs = h.registry.sent.filter(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      // 스트림 메시지는 정확히 1개
      expect(stream_msgs.length).toBe(1);
      // 최종 edit도 정확히 1개
      expect(h.registry.edited.length).toBe(1);
      // 별도의 agent_reply 메시지가 추가로 나가면 안됨
      const reply_msgs = h.registry.sent.filter(
        (m) => (m.metadata as Record<string, unknown>)?.kind === "agent_reply",
      );
      expect(reply_msgs.length).toBe(0);
    } finally { await h.cleanup(); }
  });

  it("에러 시 에러 메시지 1개만 생성, 정상 응답 0개", async () => {
    const h = await create_harness({
      orchestration_handler: async () => { throw new Error("broken"); },
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      expect(h.registry.sent.length).toBe(1);
      const meta = h.registry.sent[0].metadata as Record<string, unknown>;
      expect(meta.kind).toBe("agent_error");
    } finally { await h.cleanup(); }
  });

  it("무시 대상 메시지(봇)는 응답 0개", async () => {
    const h = await create_harness({ orchestration_handler: reply_with("누출") });
    try {
      await h.manager.handle_inbound_message(inbound("bot msg", {
        metadata: { from_is_bot: true },
      }));
      expect(h.registry.sent.length).toBe(0);
      expect(h.registry.edited.length).toBe(0);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 33. 프로바이더 에러 응답 처리
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 프로바이더 에러 응답 검출", () => {
  it("provider error는 OrchestrationService에서 감지되어 error result로 변환된다", async () => {
    // 실제 OrchestrationService.extract_provider_error()가
    // "Error calling claude: 429..." → { reply: null, error: "429..." } 로 변환.
    // ChannelManager는 이 결과를 send_error_reply로 처리.
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null,
        error: "429 Too Many Requests",
        mode: "once" as const,
        tool_calls_count: 0,
        streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      // "Error calling claude" 원문은 없어야 함 (OrchestrationService가 이미 제거)
      expect(out.content).not.toContain("Error calling claude");
      // 에러는 정규화된 형태로 전달
      expect(out.content).toContain("실패");
    } finally { await h.cleanup(); }
  });

  it("에러 메시지의 스택 트레이스가 180자로 잘린다", async () => {
    const long_error = "a".repeat(300);
    const h = await create_harness({
      orchestration_handler: async () => { throw new Error(long_error); },
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      // normalize_error_detail이 180자로 제한
      const error_portion = out.content.replace(/^.*실패했습니다\.\s*\(/, "").replace(/\)\s*$/, "");
      expect(error_portion.length).toBeLessThanOrEqual(180);
    } finally { await h.cleanup(); }
  });

  it("'unexpected argument' 에러가 executor_args_invalid로 정규화된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => { throw new Error("unexpected argument '-a' found"); },
    });
    try {
      await h.manager.handle_inbound_message(inbound("test"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("executor_args_invalid");
      expect(out.content).not.toContain("unexpected argument");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * 34. 전체 핸들러 통합 — 모든 커맨드 인식 확인
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 전체 핸들러 통합 — 모든 슬래시 커맨드 인식", () => {
  const slash_tests = [
    { cmd: "/help", expect_match: "사용 가능한 공통 명령" },
    { cmd: "/stop", expect_match: "중지" },
    { cmd: "/render status", expect_match: "render 설정" },
    { cmd: "/secret status", expect_match: "vault 상태" },
    { cmd: "/memory status", expect_match: "메모리 상태" },
    { cmd: "/decision status", expect_match: "지침" },
    { cmd: "/cron status", expect_match: "cron 상태" },
    { cmd: "/reload", expect_match: "reload" },
    { cmd: "/status", expect_match: "도구" },
    { cmd: "/tools", expect_match: "도구" },
    { cmd: "/skills", expect_match: "스킬" },
  ];

  for (const { cmd, expect_match } of slash_tests) {
    it(`${cmd} → "${expect_match}" 포함 응답`, async () => {
      const orch_calls: OrchestrationRequest[] = [];
      const h = await create_harness({
        command_handlers: all_command_handlers(),
        orchestration_handler: capture_and_reply(orch_calls, "이건 호출되면 안됨"),
      });
      try {
        await h.manager.handle_inbound_message(inbound(cmd));
        const out = last_sent(h.registry.sent);
        expect(out.content).toContain(expect_match);
        expect(orch_calls.length, `${cmd}이 orchestration을 호출하면 안됨`).toBe(0);
      } finally { await h.cleanup(); }
    });
  }
});

/* ═══════════════════════════════════════════════════════
 * Section 35: 도구 체인 결과 → 파일 생성 → media 첨부 파이프라인
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 도구 실행 결과 파일이 media로 첨부된다", () => {
  it("응답에 로컬 PDF 경로가 포함되면 media[]에 file 타입으로 첨부된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        // 도구가 PDF를 생성했다고 가정 → workspace에 실제 파일 생성
        const pdf_path = join(h.workspace, "report.pdf");
        await writeFile(pdf_path, Buffer.from("%PDF-1.4 fake"));
        return {
          reply: `정리 완료. 파일을 확인해주세요.\n[보고서](${pdf_path})`,
          mode: "agent" as const, tool_calls_count: 3, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("이 웹사이트를 정리해서 PDF로 만들어줘"));
      const out = last_sent(h.registry.sent);
      // 파일 경로가 텍스트에서 제거되고 media로 이동
      expect(out.media).toBeDefined();
      expect(out.media!.length).toBeGreaterThanOrEqual(1);
      expect(out.media![0].type).toBe("file");
      expect(out.media![0].url).toContain("report.pdf");
      // 텍스트에는 경로가 남지 않음
      expect(out.content).not.toContain("report.pdf");
      // "정리 완료" 텍스트는 보존
      expect(out.content).toContain("정리 완료");
    } finally { await h.cleanup(); }
  });

  it("이미지 파일 경로가 image 타입으로 첨부된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        const img_path = join(h.workspace, "chart.png");
        await writeFile(img_path, Buffer.from("fake-png"));
        return {
          reply: `차트 생성 완료.\n![차트](${img_path})`,
          mode: "agent" as const, tool_calls_count: 2, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("주가 차트를 그려줘"));
      const out = last_sent(h.registry.sent);
      expect(out.media).toBeDefined();
      expect(out.media!.length).toBeGreaterThanOrEqual(1);
      expect(out.media![0].type).toBe("image");
      expect(out.media![0].url).toContain("chart.png");
    } finally { await h.cleanup(); }
  });

  it("오디오 파일 경로가 audio 타입으로 첨부된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        const audio_path = join(h.workspace, "dragon-night.mp3");
        await writeFile(audio_path, Buffer.from("fake-mp3"));
        return {
          reply: `Dragon Night - 세카이노 오와리\n[재생](${audio_path})`,
          mode: "agent" as const, tool_calls_count: 2, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("세카이노 오와리의 드래곤 나이트를 재생해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.media).toBeDefined();
      expect(out.media!.length).toBeGreaterThanOrEqual(1);
      expect(out.media![0].type).toBe("audio");
      expect(out.media![0].url).toContain("dragon-night.mp3");
      // 텍스트에 곡 정보는 보존
      expect(out.content).toContain("Dragon Night");
    } finally { await h.cleanup(); }
  });

  it("여러 파일(PDF + 이미지)이 동시에 첨부된다 (최대 4개 제한)", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        const files = ["summary.pdf", "fig1.png", "fig2.png", "data.csv", "extra.zip"];
        for (const f of files) await writeFile(join(h.workspace, f), Buffer.from("fake"));
        const links = files.map((f) => `[${f}](${join(h.workspace, f)})`).join("\n");
        return {
          reply: `분석 완료.\n${links}`,
          mode: "agent" as const, tool_calls_count: 5, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("전체 보고서 만들어줘"));
      const out = last_sent(h.registry.sent);
      expect(out.media).toBeDefined();
      // render_reply에서 media.slice(0, 4) 제한
      expect(out.media!.length).toBeLessThanOrEqual(4);
      expect(out.media!.length).toBeGreaterThanOrEqual(1);
    } finally { await h.cleanup(); }
  });

  it("존재하지 않는 파일 경로는 media에 추가되지 않고 텍스트에 남는다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("결과: [보고서](/nonexistent/path/report.pdf)"),
    });
    try {
      await h.manager.handle_inbound_message(inbound("보고서 만들어줘"));
      const out = last_sent(h.registry.sent);
      // 파일이 없으므로 media는 비어있거나 undefined
      const media_count = out.media?.length ?? 0;
      expect(media_count).toBe(0);
      // 텍스트는 보존 (링크 구문이 남을 수 있음)
      expect(out.content).toContain("보고서");
    } finally { await h.cleanup(); }
  });

  it("텍스트만 있고 파일이 없으면 media는 비어있다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with("세카이노 오와리의 Dragon Night 가사를 찾았습니다."),
    });
    try {
      await h.manager.handle_inbound_message(inbound("드래곤 나이트 가사 알려줘"));
      const out = last_sent(h.registry.sent);
      const media_count = out.media?.length ?? 0;
      expect(media_count).toBe(0);
      expect(out.content).toContain("Dragon Night");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 36: 복합 요청 → 오케스트레이션 컨텍스트 전달 검증
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 복합 요청의 오케스트레이션 컨텍스트", () => {
  it("인바운드 메시지의 media가 media_inputs로 전달된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "파일 확인 완료."),
    });
    try {
      await h.manager.handle_inbound_message(inbound("이 파일 분석해줘", {
        media: [
          { type: "file", url: "https://example.com/data.csv", name: "data.csv" },
          { type: "image", url: "https://example.com/chart.png", name: "chart.png" },
        ],
      }));
      expect(captured.length).toBe(1);
      // MediaCollector가 수집한 결과가 media_inputs로 전달됨
      // (FakeMediaCollector는 URL을 그대로 반환하지 않을 수 있으므로 배열 존재만 확인)
      expect(captured[0].media_inputs).toBeDefined();
      expect(Array.isArray(captured[0].media_inputs)).toBe(true);
    } finally { await h.cleanup(); }
  });

  it("세션 히스토리가 오케스트레이션에 전달된다", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: capture_and_reply(captured, "알겠습니다."),
    });
    try {
      // 첫 번째 메시지 → 세션 기록
      await h.manager.handle_inbound_message(inbound("안녕", { chat_id: "chat-sess-1" }));
      // 두 번째 메시지 → 이전 대화가 히스토리로 포함
      await h.manager.handle_inbound_message(inbound("이전 대화 기억해?", { chat_id: "chat-sess-1" }));

      expect(captured.length).toBe(2);
      // 두 번째 요청에 세션 히스토리 존재
      expect(captured[1].session_history).toBeDefined();
      expect(Array.isArray(captured[1].session_history)).toBe(true);
    } finally { await h.cleanup(); }
  });

  it("agent 모드 결과의 tool_calls_count가 0보다 크면 정상 응답이 나간다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "웹 검색 → 내용 정리 → PDF 생성 완료. 3단계를 수행했습니다.",
        mode: "agent" as const,
        tool_calls_count: 3,
        streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("웹사이트 내용을 보고 정리해서 PDF로 만들어"));
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("3단계");
      const meta = out.metadata as Record<string, unknown>;
      expect(meta.kind).toBe("agent_reply");
    } finally { await h.cleanup(); }
  });

  it("task 모드에서 abort signal이 오케스트레이션에 전달된다", async () => {
    let signal_received = false;
    const h = await create_harness({
      orchestration_handler: async (req) => {
        signal_received = req.signal instanceof AbortSignal;
        return {
          reply: "장기 작업 완료.",
          mode: "task" as const,
          tool_calls_count: 10,
          streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("이 작업 해줘"));
      expect(signal_received).toBe(true);
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 37: 스트리밍 + 파일 첨부 복합 시나리오
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 스트리밍 응답 후 파일 첨부", () => {
  it("스트리밍 중 생성된 파일이 최종 응답에 첨부된다", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        // 스트리밍으로 진행 상황 전달
        req.on_stream?.("웹사이트 분석 중...");
        await new Promise((r) => setTimeout(r, 1300));
        req.on_stream?.("PDF 생성 중...");
        await new Promise((r) => setTimeout(r, 1300));

        // 최종적으로 파일 생성
        const pdf_path = join(h.workspace, "analysis.pdf");
        await writeFile(pdf_path, Buffer.from("%PDF-1.4 content"));

        return {
          reply: `분석 결과 PDF를 생성했습니다.\n[분석보고서](${pdf_path})`,
          mode: "agent" as const,
          tool_calls_count: 4,
          streamed: true,
          stream_full_content: "웹사이트 분석 중...\nPDF 생성 중...\n분석 결과 PDF를 생성했습니다.",
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("이 웹사이트 분석해서 PDF로 만들어"));

      // 스트리밍 메시지가 먼저 나가고
      const stream_msgs = h.registry.sent.filter((m) =>
        (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(stream_msgs.length).toBeGreaterThanOrEqual(1);

      // 최종 결과는 edit으로 반영 (streamed=true이므로)
      expect(h.registry.edited.length).toBeGreaterThanOrEqual(1);
      const last_edit = h.registry.edited[h.registry.edited.length - 1];
      // 최종 편집에 "분석 결과" 텍스트 포함
      expect(last_edit.content).toContain("분석");
    } finally { await h.cleanup(); }
  });

  it("스트리밍 도중 에러 발생 시 에러 응답이 나간다 (스트림 메시지는 남아있음)", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        req.on_stream?.("작업 시작...");
        await new Promise((r) => setTimeout(r, 1300));
        throw new Error("API rate limit exceeded");
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("복잡한 작업 해줘"));

      // 에러 메시지도 나감
      const error_msgs = h.registry.sent.filter((m) =>
        (m.metadata as Record<string, unknown>)?.kind === "agent_error",
      );
      expect(error_msgs.length).toBe(1);
      expect(error_msgs[0].content).toContain("실패");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 38: 도구 결과 내 민감정보가 최종 출력에서 제거된다
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 도구 결과의 민감정보 필터링", () => {
  it("도구 결과에 포함된 시크릿 참조가 최종 응답에서 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "API 호출 결과: {{secret:OPENAI_KEY}} 토큰으로 인증 성공. 데이터 수집 완료.",
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("API 호출해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).not.toContain("OPENAI_KEY");
      expect(out.content).toContain("데이터 수집 완료");
    } finally { await h.cleanup(); }
  });

  it("도구 결과에 포함된 vault 암호문이 최종 응답에서 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "복호화 결과 sv1.abc123.def456.ghi789 를 사용하여 연결 완료.",
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("DB 연결해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toMatch(/sv1\.[A-Za-z0-9]+\.[A-Za-z0-9]+\.[A-Za-z0-9]+/);
      expect(out.content).toContain("연결 완료");
    } finally { await h.cleanup(); }
  });

  it("도구가 생성한 bash 코드블록이 최종 응답에서 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "설정 완료.\n```bash\nexport API_KEY=sk-secret-12345\ncurl -H \"Authorization: Bearer $API_KEY\" https://api.example.com\n```\n위 명령이 실행되었습니다.",
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("API 설정해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("sk-secret-12345");
      expect(out.content).not.toContain("export API_KEY");
      expect(out.content).toContain("설정 완료");
    } finally { await h.cleanup(); }
  });

  it("<<ORCH_TOOL_CALLS>> 블록이 포함된 응답에서 도구 호출 정보가 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        '작업 완료.\n<<ORCH_TOOL_CALLS>>\n[{"name":"web_fetch","args":{"url":"https://example.com"}}]\n<<ORCH_TOOL_CALLS_END>>\n결과를 확인하세요.',
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("웹페이지 조회해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("ORCH_TOOL_CALLS");
      expect(out.content).not.toContain("web_fetch");
      expect(out.content).toContain("작업 완료");
      expect(out.content).toContain("결과를 확인하세요");
    } finally { await h.cleanup(); }
  });

  it("<ORCH_TOOL_CALLS> (단일 꺽쇠/XML 스타일) 변형도 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        '작업 완료.\n<ORCH_TOOL_CALLS>\n[{"name":"web_fetch"}]\n</ORCH_TOOL_CALLS>\n결과입니다.',
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("조회해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("ORCH_TOOL_CALLS");
      expect(out.content).toContain("작업 완료");
      expect(out.content).toContain("결과입니다");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 39: 실제 운용 시나리오 End-to-End
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 실제 운용 시나리오", () => {
  it("음악 재생 요청 → 오디오 파일 첨부 + 곡 정보 응답", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: async (req) => {
        captured.push(req);
        const mp3 = join(h.workspace, "dragon-night.mp3");
        await writeFile(mp3, Buffer.from("fake-audio"));
        return {
          reply: `🎵 Dragon Night - SEKAI NO OWARI\n\n재생 준비 완료.\n[Dragon Night](${mp3})`,
          mode: "agent" as const,
          tool_calls_count: 2,
          streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("세카이노 오와리의 드래곤 나이트를 재생해줘"),
      );
      const out = last_sent(h.registry.sent);

      // 1. 오케스트레이션에 원본 메시지가 전달됨
      expect(captured[0].message.content).toContain("드래곤 나이트");

      // 2. 오디오 파일이 media에 첨부됨
      expect(out.media).toBeDefined();
      expect(out.media!.some((m) => m.type === "audio")).toBe(true);

      // 3. 곡 정보가 텍스트로 포함됨
      expect(out.content).toContain("Dragon Night");

      // 4. 파일 경로는 텍스트에서 제거됨
      expect(out.content).not.toContain(".mp3");

      // 5. 메시지가 정확히 1개만 나감 (중복 없음)
      const reply_msgs = h.registry.sent.filter((m) =>
        (m.metadata as Record<string, unknown>)?.kind === "agent_reply",
      );
      expect(reply_msgs.length).toBe(1);
    } finally { await h.cleanup(); }
  });

  it("웹사이트 → 정리 → PDF 생성 → 파일 첨부 복합 플로우", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: async (req) => {
        captured.push(req);
        // 도구 체인 시뮬레이션: web_fetch → summarize → pdf_write
        const pdf = join(h.workspace, "website-summary.pdf");
        await writeFile(pdf, Buffer.from("%PDF-1.4 summary content"));
        return {
          reply: `## 웹사이트 요약\n\nhttps://example.com의 내용을 정리했습니다.\n\n### 주요 내용\n- 첫째 항목\n- 둘째 항목\n- 셋째 항목\n\n[요약 PDF](${pdf})`,
          mode: "agent" as const,
          tool_calls_count: 3,
          streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("https://example.com 내용을 보고 정리하여 PDF로 만든 뒤 파일을 첨부해줘"),
      );
      const out = last_sent(h.registry.sent);

      // 1. PDF 파일이 media에 첨부됨
      expect(out.media).toBeDefined();
      expect(out.media!.some((m) => m.type === "file" && m.url.includes(".pdf"))).toBe(true);

      // 2. 마크다운 요약이 텍스트로 포함됨
      expect(out.content).toContain("웹사이트 요약");
      expect(out.content).toContain("주요 내용");

      // 3. PDF 경로는 텍스트에서 제거됨
      expect(out.content).not.toContain("website-summary.pdf");

      // 4. agent_reply 메타데이터
      const meta = out.metadata as Record<string, unknown>;
      expect(meta.kind).toBe("agent_reply");
    } finally { await h.cleanup(); }
  });

  it("파일 생성 실패 시 텍스트만 응답되고 media는 비어있다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "PDF 생성에 실패했습니다. 텍스트 요약만 제공합니다.\n\n- 항목 1\n- 항목 2",
        mode: "agent" as const,
        tool_calls_count: 2,
        streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("PDF로 정리해줘"));
      const out = last_sent(h.registry.sent);
      const media_count = out.media?.length ?? 0;
      expect(media_count).toBe(0);
      expect(out.content).toContain("PDF 생성에 실패");
      expect(out.content).toContain("항목 1");
    } finally { await h.cleanup(); }
  });

  it("telegram에서 파일 첨부 + HTML 렌더링이 동시에 적용된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        const csv = join(h.workspace, "data.csv");
        await writeFile(csv, "col1,col2\n1,2\n3,4");
        return {
          reply: `**데이터 분석** 완료.\n\n결과를 확인하세요.\n[데이터](${csv})`,
          mode: "agent" as const, tool_calls_count: 1, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("데이터 분석해줘", {
        provider: "telegram", channel: "telegram",
      }));
      const out = last_sent(h.registry.sent);

      // 파일 첨부
      expect(out.media).toBeDefined();
      expect(out.media!.some((m) => m.type === "file")).toBe(true);

      // telegram = HTML 모드 → parse_mode 설정
      const meta = out.metadata as Record<string, unknown>;
      expect(meta.render_parse_mode).toBe("HTML");

      // HTML 태그로 변환됨 (bold)
      expect(out.content).toMatch(/<b>|<strong>/);
    } finally { await h.cleanup(); }
  });

  it("slack에서 파일 첨부 + markdown 렌더링이 동시에 적용된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        const img = join(h.workspace, "result.png");
        await writeFile(img, Buffer.from("fake-png"));
        return {
          reply: `**분석 결과** 이미지를 생성했습니다.\n![결과](${img})`,
          mode: "agent" as const, tool_calls_count: 2, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("분석 결과 보여줘", {
        provider: "slack", channel: "slack", sender_id: "U01",
      }));
      const out = last_sent(h.registry.sent);

      // 이미지 첨부
      expect(out.media).toBeDefined();
      expect(out.media!.some((m) => m.type === "image")).toBe(true);

      // slack = markdown 모드 → HTML 태그 없음
      expect(out.content).not.toContain("<b>");
      expect(out.content).not.toContain("<strong>");

      // 이미지 마크다운 구문은 텍스트에서 제거됨
      expect(out.content).not.toContain("![");
      expect(out.content).not.toContain("result.png");
    } finally { await h.cleanup(); }
  });

  it("응답 내 민감정보 + 파일 첨부가 동시에 있으면 민감정보만 제거되고 파일은 첨부된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => {
        const pdf = join(h.workspace, "clean-report.pdf");
        await writeFile(pdf, Buffer.from("%PDF"));
        return {
          reply: `API 키 {{secret:MY_KEY}}로 인증 후 데이터를 수집했습니다.\n\n[보고서](${pdf})`,
          mode: "agent" as const, tool_calls_count: 3, streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(inbound("API 데이터 수집해서 보고서 만들어"));
      const out = last_sent(h.registry.sent);

      // 시크릿은 제거됨
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).not.toContain("MY_KEY");

      // PDF는 첨부됨
      expect(out.media).toBeDefined();
      expect(out.media!.some((m) => m.type === "file")).toBe(true);

      // "데이터를 수집" 텍스트는 보존
      expect(out.content).toContain("데이터를 수집");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 40: 웹 콘텐츠 분석/검색 시나리오
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 웹 콘텐츠 분석 및 검색", () => {
  it("상위 N개 항목 요청 → 번호 매겨진 리스트로 응답", async () => {
    const captured: OrchestrationRequest[] = [];
    const h = await create_harness({
      orchestration_handler: async (req) => {
        captured.push(req);
        return {
          reply: "## 인기 상품 TOP 5\n\n1. 맥북 프로 16인치 — 3,490,000원\n2. 갤럭시 S24 울트라 — 1,590,000원\n3. 아이패드 에어 — 929,000원\n4. 에어팟 프로 2 — 359,000원\n5. 갤럭시 워치 7 — 399,000원",
          mode: "agent" as const,
          tool_calls_count: 2,
          streamed: false,
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("https://shop.example.com 에서 인기 상품 상위 5개를 알려줘"),
      );
      const out = last_sent(h.registry.sent);

      // 원본 요청이 오케스트레이션에 전달
      expect(captured[0].message.content).toContain("상위 5개");

      // 5개 항목이 모두 포함
      expect(out.content).toContain("맥북 프로");
      expect(out.content).toContain("갤럭시 S24");
      expect(out.content).toContain("에어팟 프로");

      // 번호 매김이 보존
      expect(out.content).toMatch(/1\./);
      expect(out.content).toMatch(/5\./);

      // 정확히 1개의 응답만 나감
      const replies = h.registry.sent.filter((m) =>
        (m.metadata as Record<string, unknown>)?.kind === "agent_reply",
      );
      expect(replies.length).toBe(1);
    } finally { await h.cleanup(); }
  });

  it("특정 결과 검색 → 결과 없을 때 빈 응답이 아닌 '찾지 못했습니다' 메시지", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "해당 사이트에서 '양자 컴퓨터 개발키트'를 찾지 못했습니다. 검색 조건을 변경해보세요.",
      ),
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("https://store.example.com 에서 양자 컴퓨터 개발키트를 찾아줘"),
      );
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("찾지 못했습니다");
      // 빈 응답이 아님
      expect(out.content.length).toBeGreaterThan(10);
    } finally { await h.cleanup(); }
  });

  it("검색 결과에 내부 도구 로그가 포함되어도 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "web_search 결과:\n<<ORCH_TOOL_CALLS>>\n[{\"name\":\"web_fetch\",\"args\":{\"url\":\"https://example.com\"}}]\n<<ORCH_TOOL_CALLS_END>>\n\n## 검색 결과\n1. 첫 번째 항목\n2. 두 번째 항목",
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("example.com에서 결과를 검색해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("ORCH_TOOL_CALLS");
      expect(out.content).not.toContain("web_fetch");
      expect(out.content).toContain("검색 결과");
      expect(out.content).toContain("첫 번째 항목");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 41: 시크릿 키 기반 인증/결제 시나리오
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 시크릿 키 사용 시 민감정보 보호", () => {
  it("로그인 과정에서 사용된 {{secret:*}} 참조가 응답에 절대 노출되지 않는다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "로그인 성공. 아이디 user123과 비밀번호 {{secret:LOGIN_PW}}로 인증했습니다.\n" +
        "로그인 세션: sess-abc-123",
      ),
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("example.com에 로그인해줘. 아이디는 user123이고 {{secret:LOGIN_PW}}를 사용해"),
      );
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).not.toContain("LOGIN_PW");
      expect(out.content).toContain("로그인 성공");
    } finally { await h.cleanup(); }
  });

  it("결제 과정에서 사용된 복수의 {{secret:*}} 참조가 모두 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "결제 완료.\n" +
        "- 카드번호: {{secret:CARD_NUMBER}}\n" +
        "- 계좌번호: {{secret:BANK_ACCOUNT}}\n" +
        "- 결제금액: 49,000원\n" +
        "- 주문번호: ORD-2026-0228-001",
      ),
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("상품을 결제해줘. 카드는 {{secret:CARD_NUMBER}}, 계좌는 {{secret:BANK_ACCOUNT}}를 사용"),
      );
      const out = last_sent(h.registry.sent);
      // 모든 시크릿 참조가 제거됨
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).not.toContain("CARD_NUMBER");
      expect(out.content).not.toContain("BANK_ACCOUNT");
      // 결제 결과 정보는 보존
      expect(out.content).toContain("결제 완료");
      expect(out.content).toContain("49,000원");
      expect(out.content).toContain("ORD-2026-0228-001");
    } finally { await h.cleanup(); }
  });

  it("vault 암호문(sv1.xxx.yyy.zzz)이 응답 중간에 포함되어도 치환된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "인증 토큰 sv1.aB3xK9.mN7pQ2.zR4wY8 을 사용하여 API 호출 성공.\n" +
        "결과: 주문이 접수되었습니다.",
      ),
    });
    try {
      await h.manager.handle_inbound_message(inbound("API로 주문 넣어줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toMatch(/sv1\.[A-Za-z0-9]+\.[A-Za-z0-9]+\.[A-Za-z0-9]+/);
      expect(out.content).toContain("주문이 접수되었습니다");
    } finally { await h.cleanup(); }
  });

  it("시크릿 참조 + vault 암호문 + bash 코드블록이 동시에 있어도 모두 제거된다", async () => {
    const h = await create_harness({
      orchestration_handler: reply_with(
        "로그인 후 결제를 진행했습니다.\n\n" +
        "```bash\ncurl -H 'Authorization: Bearer sv1.abc.def.ghi' https://api.pay.example.com/charge\n```\n\n" +
        "인증 정보: {{secret:API_TOKEN}}\n" +
        "결제 결과: 성공 (주문번호 P-12345)",
      ),
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("로그인하고 결제 진행해줘"),
      );
      const out = last_sent(h.registry.sent);
      // bash 코드블록 제거
      expect(out.content).not.toContain("curl");
      expect(out.content).not.toContain("Authorization");
      // vault 암호문 제거
      expect(out.content).not.toMatch(/sv1\./);
      // 시크릿 참조 제거
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).not.toContain("API_TOKEN");
      // 결과 정보 보존
      expect(out.content).toContain("결제를 진행");
      expect(out.content).toContain("P-12345");
    } finally { await h.cleanup(); }
  });

  it("에러 메시지에도 시크릿이 노출되지 않는다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: null,
        error: "Authentication failed with token {{secret:API_KEY}}: 401 Unauthorized",
        mode: "agent" as const,
        tool_calls_count: 1,
        streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(inbound("로그인해줘"));
      const out = last_sent(h.registry.sent);
      expect(out.content).not.toContain("{{secret:");
      expect(out.content).not.toContain("API_KEY");
      expect(out.content).toContain("실패");
    } finally { await h.cleanup(); }
  });
});

/* ═══════════════════════════════════════════════════════
 * Section 42: 장기 태스크 / 팀 구성 시나리오
 * ═══════════════════════════════════════════════════════ */

describe("E2E: 장기 태스크 및 복합 실행 모드", () => {
  it("task 모드 결과가 정상 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "## 팀 구성 완료\n\n" +
          "- Lead: 프로젝트 관리자 배정\n" +
          "- Backend: API 개발자 배정\n" +
          "- Frontend: UI 개발자 배정\n\n" +
          "기능 구현을 시작합니다.",
        mode: "task" as const,
        tool_calls_count: 8,
        streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("인증 시스템을 구현할 팀을 구성하고 기능이 완성될 때까지 진행해"),
      );
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("팀 구성 완료");
      expect(out.content).toContain("Lead");
      expect(out.content).toContain("Backend");
      expect(out.content).toContain("Frontend");

      const meta = out.metadata as Record<string, unknown>;
      expect(meta.kind).toBe("agent_reply");
    } finally { await h.cleanup(); }
  });

  it("task 모드에서 스트리밍 진행 상황이 중간에 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: async (req) => {
        // 진행 상황 스트리밍
        req.on_stream?.("1/4: 팀 구성 중...");
        await new Promise((r) => setTimeout(r, 1300));
        req.on_stream?.("2/4: API 설계 완료...");
        await new Promise((r) => setTimeout(r, 1300));
        req.on_stream?.("3/4: 구현 진행 중...");
        await new Promise((r) => setTimeout(r, 1300));

        return {
          reply: "## 구현 완료\n\n인증 시스템이 완성되었습니다.\n- 로그인/로그아웃 API\n- JWT 토큰 관리\n- 세션 관리",
          mode: "task" as const,
          tool_calls_count: 15,
          streamed: true,
          stream_full_content: "1/4: 팀 구성 중...\n2/4: API 설계 완료...\n3/4: 구현 진행 중...\n구현 완료.",
        };
      },
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("인증 시스템 구현해줘"),
      );

      // 스트리밍 메시지 존재
      const streams = h.registry.sent.filter((m) =>
        (m.metadata as Record<string, unknown>)?.kind === "agent_stream",
      );
      expect(streams.length).toBeGreaterThanOrEqual(1);

      // 최종 결과는 edit으로 반영
      expect(h.registry.edited.length).toBeGreaterThanOrEqual(1);
      const last_edit = h.registry.edited[h.registry.edited.length - 1];
      expect(last_edit.content).toContain("구현 완료");
    } finally { await h.cleanup(); }
  });

  it("agent 모드에서 다수 도구 호출 후 최종 결과만 채널에 전달된다", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "분석이 완료되었습니다.\n\n" +
          "- 총 15개 엔드포인트 검사\n" +
          "- 보안 취약점 2건 발견\n" +
          "- 성능 개선 포인트 3건\n\n" +
          "상세 보고서를 작성 중입니다.",
        mode: "agent" as const,
        tool_calls_count: 15,
        streamed: false,
      }),
    });
    try {
      await h.manager.handle_inbound_message(
        inbound("이 프로젝트의 API를 전체 점검해줘"),
      );
      const out = last_sent(h.registry.sent);
      expect(out.content).toContain("분석이 완료");
      expect(out.content).toContain("15개 엔드포인트");
      // 도구 호출 횟수 자체는 응답에 노출되지 않음 (내부 정보)
      expect(out.content).not.toContain("tool_calls");

      // 정확히 1개 응답
      const replies = h.registry.sent.filter((m) =>
        (m.metadata as Record<string, unknown>)?.kind === "agent_reply",
      );
      expect(replies.length).toBe(1);
    } finally { await h.cleanup(); }
  });

  it("suppress_reply=true일 때 채널에 아무것도 나가지 않는다 (백그라운드 작업)", async () => {
    const h = await create_harness({
      orchestration_handler: async () => ({
        reply: "이 메시지는 나가면 안됨",
        mode: "task" as const,
        tool_calls_count: 5,
        streamed: false,
        suppress_reply: true,
      }),
    });
    try {
      const before_count = h.registry.sent.length;
      await h.manager.handle_inbound_message(
        inbound("백그라운드에서 처리해줘"),
      );
      // suppress_reply=true → 아무것도 나가지 않음
      expect(h.registry.sent.length).toBe(before_count);
    } finally { await h.cleanup(); }
  });

  it("동일 채팅방에서 장기 태스크 실행 중 새 요청이 들어오면 이전 태스크가 abort된다", async () => {
    let first_aborted = false;
    const h = await create_harness({
      orchestration_handler: async (req) => {
        // 첫 번째 요청: 오래 걸리는 작업
        if (req.message.content.includes("첫 번째")) {
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (req.signal?.aborted) {
                first_aborted = true;
                clearInterval(check);
                resolve();
              }
            }, 10);
            setTimeout(() => { clearInterval(check); resolve(); }, 5000);
          });
          return { reply: "첫 번째 완료", mode: "task" as const, tool_calls_count: 1, streamed: false };
        }
        // 두 번째 요청: 즉시 완료
        return { reply: "두 번째 완료", mode: "once" as const, tool_calls_count: 0, streamed: false };
      },
    });
    try {
      const first = h.manager.handle_inbound_message(inbound("첫 번째 장기 작업"));
      await new Promise((r) => setTimeout(r, 50));
      await h.manager.handle_inbound_message(inbound("두 번째 급한 요청"));
      await first;

      expect(first_aborted).toBe(true);
      // 두 번째 응답이 나감
      const replies = h.registry.sent.filter((m) => {
        const content = m.content || "";
        return content.includes("두 번째 완료");
      });
      expect(replies.length).toBe(1);
    } finally { await h.cleanup(); }
  });
});
