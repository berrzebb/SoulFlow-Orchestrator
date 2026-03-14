/**
 * OrchestrationService — constructor + 공개/비공개 메서드 커버리지 보충.
 * format_hitl_prompt, detect_hitl_type 모듈 레벨 함수도 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { OrchestrationService, format_hitl_prompt, detect_hitl_type } from "@src/orchestration/service.js";
import { HitlPendingStore } from "@src/orchestration/hitl-pending-store.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

// ══════════════════════════════════════════
// 테스트 픽스처
// ══════════════════════════════════════════

function make_cb_mock() {
  return {
    get_persona_name: vi.fn().mockReturnValue("Aria"),
    get_bootstrap: vi.fn().mockReturnValue({ exists: false, content: "" }),
    memory_store: { append_daily: vi.fn().mockResolvedValue(undefined) },
    skills_loader: {
      get_role_skill: vi.fn().mockReturnValue(null),
      build_skill_summary: vi.fn().mockReturnValue(""),
      load_skills_for_context: vi.fn().mockReturnValue(""),
      load_role_context: vi.fn().mockReturnValue(""),
    },
    build_system_prompt: vi.fn().mockResolvedValue("system_prompt"),
    build_role_system_prompt: vi.fn().mockResolvedValue("role_prompt"),
  };
}

function make_mock_renderer() {
  return { render: vi.fn().mockReturnValue("rendered_output") };
}

function make_service(opts: {
  events?: boolean;
  provider_caps?: boolean;
  renderer?: boolean;
} = {}) {
  const cb = make_cb_mock();
  const mock_events = opts.events
    ? { append: vi.fn().mockResolvedValue(undefined) }
    : undefined;

  return {
    service: new OrchestrationService({
      providers: {
        run_orchestrator: vi.fn().mockResolvedValue({ content: "summary_text" }),
      } as any,
      agent_runtime: {
        get_context_builder: vi.fn().mockReturnValue(cb),
        execute_tool: vi.fn().mockResolvedValue({}),
      } as any,
      secret_vault: { list_references: vi.fn().mockResolvedValue([]) } as any,
      runtime_policy_resolver: { resolve: vi.fn().mockResolvedValue({}) } as any,
      config: {
        executor_provider: "chatgpt" as any,
        provider_caps: opts.provider_caps
          ? { chatgpt_available: true, claude_available: true, openrouter_available: false }
          : undefined,
        agent_loop_max_turns: 10,
        task_loop_max_turns: 20,
        streaming_enabled: true,
        streaming_interval_ms: 100,
        streaming_min_chars: 50,
        max_tool_result_chars: 10000,
        orchestrator_max_tokens: 1000,
      },
      logger: {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
      } as any,
      hitl_pending_store: new HitlPendingStore(),
      session_cd: {
        get_score: vi.fn().mockReturnValue({ total: 0, events: [] }),
        record: vi.fn(),
        reset: vi.fn(),
      },
      events: mock_events as any,
      renderer: opts.renderer ? make_mock_renderer() as any : null,
    }),
    cb,
    mock_events,
  };
}

// ══════════════════════════════════════════
// constructor
// ══════════════════════════════════════════

describe("OrchestrationService — constructor", () => {
  it("기본 의존성으로 인스턴스 생성", () => {
    const { service } = make_service();
    expect(service).toBeDefined();
  });

  it("provider_caps 있을 때 생성", () => {
    const { service } = make_service({ provider_caps: true });
    expect(service).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 공개 메서드
// ══════════════════════════════════════════

describe("OrchestrationService — get_cd_score / reset_cd_score", () => {
  it("get_cd_score → session_cd.get_score() 위임", () => {
    const { service } = make_service();
    const score = service.get_cd_score();
    expect(score).toEqual({ total: 0, events: [] });
  });

  it("reset_cd_score → session_cd.reset() 위임", () => {
    const { service } = make_service();
    expect(() => service.reset_cd_score()).not.toThrow();
  });
});

describe("OrchestrationService — get_phase_hitl_bridge", () => {
  it("bridge.try_resolve → hitl_store.try_resolve 위임", async () => {
    const { service } = make_service();
    const bridge = service.get_phase_hitl_bridge();
    // store에 pending 없으면 false
    const result = await bridge.try_resolve("chat1", "answer");
    expect(result).toBe(false);
  });
});

// ══════════════════════════════════════════
// 비공개 메서드 — (service as any)로 접근
// ══════════════════════════════════════════

describe("OrchestrationService — build_persona_followup", () => {
  it("heart 있으면 [응답 어투] 포함", () => {
    const { service } = make_service();
    const r = (service as any).build_persona_followup("friendly tone");
    expect(r).toContain("[응답 어투]");
    expect(r).toContain("friendly tone");
  });

  it("heart 없으면 기본 지시만 반환", () => {
    const { service } = make_service();
    const r = (service as any).build_persona_followup("");
    expect(r).toContain("위 실행 결과를 바탕으로");
    expect(r).not.toContain("[응답 어투]");
  });
});

describe("OrchestrationService — log_event", () => {
  it("events 없으면 무시 (오류 없음)", () => {
    const { service } = make_service({ events: false });
    expect(() => (service as any).log_event({ task_id: "t1", event_type: "assigned" } as any)).not.toThrow();
  });

  it("events 있으면 append 호출", () => {
    const { service, mock_events } = make_service({ events: true });
    (service as any).log_event({ task_id: "t1", event_type: "assigned" } as any);
    expect(mock_events!.append).toHaveBeenCalled();
  });
});

describe("OrchestrationService — _caps", () => {
  it("provider_caps 없으면 기본값 반환", () => {
    const { service } = make_service();
    const caps = (service as any)._caps();
    expect(caps.chatgpt_available).toBe(true);
    expect(caps.claude_available).toBe(false);
  });

  it("provider_caps 주입 시 해당 값 반환", () => {
    const { service } = make_service({ provider_caps: true });
    const caps = (service as any)._caps();
    expect(caps.claude_available).toBe(true);
  });
});

describe("OrchestrationService — _get_renderer", () => {
  it("renderer 주입 시 주입된 renderer 반환", () => {
    const { service } = make_service({ renderer: true });
    const r = (service as any)._get_renderer();
    expect(r).toBeDefined();
    expect(typeof r.render).toBe("function");
  });

  it("renderer 미주입 시 PersonaMessageRenderer 생성", () => {
    const { service } = make_service({ renderer: false });
    const r = (service as any)._get_renderer();
    expect(r).toBeDefined();
    expect(typeof r.render).toBe("function");
  });
});

describe("OrchestrationService — _build_identity_reply / _build_safe_fallback_reply / _render_hitl", () => {
  it("_build_identity_reply → renderer.render 호출", () => {
    const { service } = make_service({ renderer: true });
    const r = (service as any)._build_identity_reply();
    expect(typeof r).toBe("string");
  });

  it("_build_safe_fallback_reply → renderer.render 호출", () => {
    const { service } = make_service({ renderer: true });
    const r = (service as any)._build_safe_fallback_reply();
    expect(typeof r).toBe("string");
  });

  it("_render_hitl → renderer.render 호출 (choice 타입)", () => {
    const { service } = make_service({ renderer: true });
    const r = (service as any)._render_hitl("본문", "choice");
    expect(typeof r).toBe("string");
  });
});

describe("OrchestrationService — build_compaction_flush", () => {
  it("memory_store 있으면 flush 함수 반환", async () => {
    const { service } = make_service();
    const cfg = (service as any).build_compaction_flush();
    expect(cfg).toBeDefined();
    expect(cfg.context_window).toBe(200_000);
    await expect(cfg.flush()).resolves.toBeUndefined();
  });
});

describe("OrchestrationService — _convert_agent_result", () => {
  function stream() { return new StreamBuffer(); }

  function make_req() {
    return { provider: "slack", message: { sender_id: "u1", chat_id: "c1" }, alias: "" } as any;
  }

  it("finish_reason='error' → error_result", () => {
    const { service } = make_service();
    const r = (service as any)._convert_agent_result(
      { finish_reason: "error", content: "", metadata: { error: "boom" }, tool_calls_count: 0, usage: undefined },
      "once", stream(), make_req()
    );
    expect(r.error).toBe("boom");
    expect(r.reply).toBeNull();
  });

  it("finish_reason='cancelled' → suppress_result", () => {
    const { service } = make_service();
    const r = (service as any)._convert_agent_result(
      { finish_reason: "cancelled", content: "x", tool_calls_count: 1, usage: undefined },
      "once", stream(), make_req()
    );
    expect(r.suppress_reply).toBe(true);
    expect(r.reply).toBeNull();
  });

  it("빈 content → safe fallback reply", () => {
    const { service } = make_service({ renderer: true });
    const r = (service as any)._convert_agent_result(
      { finish_reason: "stop", content: "", tool_calls_count: 0, usage: undefined },
      "once", stream(), make_req()
    );
    expect(r.reply).toBeTruthy();
  });

  it("정상 content + once 모드 → reply 반환", () => {
    const { service } = make_service();
    const r = (service as any)._convert_agent_result(
      { finish_reason: "stop", content: "done!", tool_calls_count: 0, usage: undefined },
      "once", stream(), make_req()
    );
    expect(r.reply).toContain("done!");
  });

  it("agent 모드 + tool_calls=0 → no-tool notice 추가", () => {
    const { service } = make_service();
    const r = (service as any)._convert_agent_result(
      { finish_reason: "stop", content: "result", tool_calls_count: 0, usage: undefined },
      "agent", stream(), make_req()
    );
    expect(r.reply).toContain("작업이 완료되었습니다");
  });

  it("finish_reason='max_turns' → 경고 메시지 추가", () => {
    const { service } = make_service();
    const r = (service as any)._convert_agent_result(
      { finish_reason: "max_turns", content: "partial", tool_calls_count: 3, usage: undefined },
      "once", stream(), make_req()
    );
    expect(r.reply).toContain("최대 턴 수");
  });

  it("usage 데이터 → ResultUsage 변환", () => {
    const { service } = make_service();
    const r = (service as any)._convert_agent_result(
      { finish_reason: "stop", content: "ok", tool_calls_count: 1,
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, total_cost_usd: 0.001 } },
      "once", stream(), make_req()
    );
    expect(r.usage).toBeDefined();
  });
});

describe("OrchestrationService — _generate_guard_summary", () => {
  it("providers.run_orchestrator 성공 시 summary 반환", async () => {
    const { service } = make_service();
    const r = await (service as any)._generate_guard_summary("파일을 삭제하시겠습니까?");
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("providers.run_orchestrator 실패 시 텍스트 슬라이스 폴백", async () => {
    const { service } = make_service();
    (service as any).providers.run_orchestrator = vi.fn().mockRejectedValue(new Error("unavail"));
    const long_text = "x".repeat(300);
    const r = await (service as any)._generate_guard_summary(long_text);
    expect(r.endsWith("...")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(203);
  });
});

// ══════════════════════════════════════════
// 모듈 레벨 함수
// ══════════════════════════════════════════

describe("format_hitl_prompt", () => {
  it("기본 choice 타입 → 선택 요청 헤더 포함", () => {
    const r = format_hitl_prompt("A 또는 B를 선택하세요", "task1");
    expect(r).toContain("선택 요청");
    expect(r).toContain("A 또는 B를 선택하세요");
  });

  it("confirmation 타입 → 확인 요청 헤더", () => {
    const r = format_hitl_prompt("계속할까요?", "t1", "confirmation");
    expect(r).toContain("확인 요청");
  });

  it("question 타입 → 질문 헤더", () => {
    const r = format_hitl_prompt("이름이 무엇인가요?", "t1", "question");
    expect(r).toContain("질문");
  });

  it("escalation 타입 → 판단 필요 헤더", () => {
    const r = format_hitl_prompt("결과를 검토해주세요", "t1", "escalation");
    expect(r).toContain("판단 필요");
  });

  it("error 타입 → 작업 실패 헤더", () => {
    const r = format_hitl_prompt("오류가 발생했습니다", "t1", "error");
    expect(r).toContain("작업 실패");
  });

  it("빈 prompt → '추가 정보가 필요합니다' 폴백", () => {
    const r = format_hitl_prompt("", "t1");
    expect(r).toContain("추가 정보가 필요합니다");
  });

  it("__request_user_choice__ 토큰 제거", () => {
    const r = format_hitl_prompt("선택__request_user_choice__", "t1");
    expect(r).not.toContain("__request_user_choice__");
  });
});

// ══════════════════════════════════════════
// L465-466: _convert_agent_result — normalize_agent_reply → null
// ══════════════════════════════════════════

describe("OrchestrationService — _convert_agent_result normalize_agent_reply=null (L465-466)", () => {
  it("content이 leading-mention만 있을 때 → normalize 후 null → L465-466 warn + fallback reply", () => {
    const { service } = make_service({ renderer: true });
    const stream = new StreamBuffer();
    const req = { provider: "slack", message: { sender_id: "U001", chat_id: "C1" }, alias: "" } as any;
    // "@U001" → sanitize_provider_output("@U001") = "@U001" (non-empty) → normalize_agent_reply strips leading @mention → null
    const r = (service as any)._convert_agent_result(
      { finish_reason: "stop", content: "@U001", tool_calls_count: 0, usage: undefined },
      "agent", stream, req,
    );
    // L466: reply_result with safe fallback
    expect(r.reply).toBeTruthy();
    expect(r.mode).toBe("agent");
  });
});

// ══════════════════════════════════════════
// L478-507: _build_system_prompt — role_skill / concierge_skill 분기
// ══════════════════════════════════════════

describe("OrchestrationService — _build_system_prompt (L478-507)", () => {
  it("alias 있고 role_skill 존재 → compiler 경로로 base + role section 합성 (RP-4)", async () => {
    const { service, cb } = make_service();
    // alias="assistant" → get_role_skill("assistant") 반환값 있음 (compiler가 사용)
    cb.skills_loader.get_role_skill = vi.fn().mockReturnValue({ role: "assistant", heart: "role persona", soul: "soul text" });
    cb.build_system_prompt = vi.fn().mockResolvedValue("base_system");

    const result = await (service as any)._build_system_prompt(
      ["skill1"], "slack", "C1", undefined, "assistant",
    );

    // RP-4: compiler 경로 → base + rendered role section
    expect(result).toContain("base_system");
    expect(result).toContain("# Role: assistant");
  });

  it("alias 없음 + concierge_skill heart 있음 → 기본 프롬프트 + Active Role 힌트 (L493-497)", async () => {
    const { service, cb } = make_service();
    // alias 없음 → role_skill check 스킵
    cb.skills_loader.get_role_skill = vi.fn().mockImplementation((role: string) =>
      role === "concierge" ? { heart: "concierge persona" } : null,
    );
    cb.build_system_prompt = vi.fn().mockResolvedValue("base_system");

    const result = await (service as any)._build_system_prompt(
      [], "slack", "C1", undefined, undefined,
    );

    expect(cb.build_system_prompt).toHaveBeenCalled();
    expect(result).toContain("base_system");
    expect(result).toContain("Active Role: concierge");
    expect(result).toContain("concierge persona");
  });

  it("alias 없음 + concierge_skill heart 없음 → 기본 프롬프트만 (L494 else)", async () => {
    const { service, cb } = make_service();
    cb.skills_loader.get_role_skill = vi.fn().mockReturnValue(null);
    cb.build_system_prompt = vi.fn().mockResolvedValue("base_system_only");

    const result = await (service as any)._build_system_prompt(
      [], "slack", "C1", undefined, undefined,
    );

    expect(result).toBe("base_system_only");
    expect(result).not.toContain("Active Role");
  });
});

describe("detect_hitl_type", () => {
  it("빈 문자열 → question", () => {
    expect(detect_hitl_type("")).toBe("question");
  });

  it("진행할까요 → confirmation", () => {
    expect(detect_hitl_type("진행할까요?")).toBe("confirmation");
  });

  it("yes/no 패턴 → confirmation", () => {
    expect(detect_hitl_type("yes/no")).toBe("confirmation");
  });

  it("번호 목록 2개 이상 → choice", () => {
    expect(detect_hitl_type("1. 옵션 A\n2. 옵션 B")).toBe("choice");
  });

  it("불릿 목록 2개 이상 → choice", () => {
    expect(detect_hitl_type("- 항목1\n- 항목2\n- 항목3")).toBe("choice");
  });

  it("일반 질문 → question", () => {
    expect(detect_hitl_type("이름을 알려주세요")).toBe("question");
  });
});
