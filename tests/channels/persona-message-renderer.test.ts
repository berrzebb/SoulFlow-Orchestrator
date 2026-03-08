/**
 * PersonaMessageRenderer — 전체 커버리지.
 * concept pack, parse_heart_hints, TonePreferenceStore,
 * 모든 intent 렌더링, parse_tone_override.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PersonaMessageRenderer,
  TonePreferenceStore,
  get_concept_pack,
  list_concept_packs,
  parse_concept_directive,
  parse_tone_override,
  type PersonaStyleSource,
} from "@src/channels/persona-message-renderer.js";

// ── 기본 스타일 소스 ──────────────────────────────────

function make_source(opts: {
  name?: string;
  heart?: string;
  tone_pref?: Record<string, object>;
}): PersonaStyleSource {
  return {
    get_persona_name: () => opts.name ?? "테스트봇",
    get_heart: () => opts.heart ?? "",
    get_tone_preference: (chat_key: string) => (opts.tone_pref?.[chat_key] ?? {}) as any,
  };
}

// ══════════════════════════════════════════
// get_concept_pack / list_concept_packs
// ══════════════════════════════════════════

describe("concept pack 조회", () => {
  it("list_concept_packs → 등록된 pack 목록 반환", () => {
    const packs = list_concept_packs();
    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]).toHaveProperty("id");
    expect(packs[0]).toHaveProperty("label");
  });

  it("get_concept_pack('fantasy_hero') → pack 반환", () => {
    const p = get_concept_pack("fantasy_hero");
    expect(p).not.toBeNull();
    expect(p!.id).toBe("fantasy_hero");
  });

  it("get_concept_pack('nonexistent') → null", () => {
    expect(get_concept_pack("nonexistent")).toBeNull();
  });
});

// ══════════════════════════════════════════
// parse_concept_directive
// ══════════════════════════════════════════

describe("parse_concept_directive", () => {
  it("빈 문자열 → null", () => {
    expect(parse_concept_directive("")).toBeNull();
  });

  it("pack label 포함 텍스트 → pack id 반환", () => {
    const r = parse_concept_directive("판타지 주인공처럼 대답해줘");
    expect(r).toBe("fantasy_hero");
  });

  it("pack id 포함 텍스트 → pack id 반환", () => {
    const r = parse_concept_directive("cosmic_observer 스타일");
    expect(r).toBe("cosmic_observer");
  });

  it("'처럼' 패턴 → adhoc: 반환", () => {
    const r = parse_concept_directive("셜록 홈즈처럼 대답해줘");
    expect(r).toMatch(/^adhoc:/);
    expect(r).toContain("셜록 홈즈");
  });

  it("'같이' 패턴 → adhoc: 반환", () => {
    const r = parse_concept_directive("아이언맨같이 말해");
    expect(r).toMatch(/^adhoc:/);
  });

  it("패턴 없음 → null", () => {
    expect(parse_concept_directive("그냥 평범한 요청")).toBeNull();
  });
});

// ══════════════════════════════════════════
// parse_tone_override
// ══════════════════════════════════════════

describe("parse_tone_override", () => {
  it("빈 문자열 → null", () => {
    expect(parse_tone_override("")).toBeNull();
  });

  it("반말 → politeness: casual", () => {
    const r = parse_tone_override("반말로 해줘");
    expect(r?.politeness).toBe("casual");
  });

  it("친근 → politeness: casual_polite", () => {
    const r = parse_tone_override("친근하게 해줘");
    expect(r?.politeness).toBe("casual_polite");
  });

  it("차갑게 → warmth: cool", () => {
    const r = parse_tone_override("차가운 톤으로");
    expect(r?.warmth).toBe("cool");
  });

  it("따뜻하게 → warmth: warm", () => {
    const r = parse_tone_override("따뜻하게");
    expect(r?.warmth).toBe("warm");
  });

  it("짧게 → brevity: short", () => {
    const r = parse_tone_override("짧게 말해줘");
    expect(r?.brevity).toBe("short");
  });

  it("자세히 → brevity: detailed", () => {
    const r = parse_tone_override("자세히 설명해줘");
    expect(r?.brevity).toBe("detailed");
  });

  it("concept + 톤 → 둘 다 반환", () => {
    const r = parse_tone_override("판타지 주인공처럼 반말로");
    expect(r?.concept).toBe("fantasy_hero");
    expect(r?.politeness).toBe("casual");
  });

  it("톤 힌트 없음 → null", () => {
    expect(parse_tone_override("일반적인 요청")).toBeNull();
  });
});

// ══════════════════════════════════════════
// PersonaMessageRenderer — resolve_style
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — resolve_style", () => {
  it("기본 → DEFAULT_STYLE 기반", () => {
    const renderer = new PersonaMessageRenderer(make_source({}));
    const s = renderer.resolve_style();
    expect(s.persona_name).toBe("테스트봇");
    expect(s.language).toBe("ko");
  });

  it("persona_name=assistant → '비서'로 대체", () => {
    const renderer = new PersonaMessageRenderer(make_source({ name: "assistant" }));
    const s = renderer.resolve_style();
    expect(s.persona_name).toBe("비서");
  });

  it("HEART 힌트 반영 — 반말", () => {
    const renderer = new PersonaMessageRenderer(make_source({ heart: "반말로 해줘" }));
    const s = renderer.resolve_style();
    expect(s.politeness).toBe("casual");
  });

  it("HEART 힌트 — cool warmth", () => {
    const renderer = new PersonaMessageRenderer(make_source({ heart: "사무적으로" }));
    const s = renderer.resolve_style();
    expect(s.warmth).toBe("cool");
  });

  it("HEART 힌트 — detailed brevity", () => {
    const renderer = new PersonaMessageRenderer(make_source({ heart: "자세하게 설명해줘" }));
    const s = renderer.resolve_style();
    expect(s.brevity).toBe("detailed");
  });

  it("session override 적용", () => {
    const renderer = new PersonaMessageRenderer(make_source({}));
    const s = renderer.resolve_style({ session: { politeness: "casual" } });
    expect(s.politeness).toBe("casual");
  });

  it("chat_key + get_tone_preference → persistent 선호 반영", () => {
    const renderer = new PersonaMessageRenderer(make_source({
      tone_pref: { "chat-1": { warmth: "cool" } },
    }));
    const s = renderer.resolve_style({ chat_key: "chat-1" });
    expect(s.warmth).toBe("cool");
  });

  it("StyleOverrideOptions 형식 (session + chat_key)", () => {
    const renderer = new PersonaMessageRenderer(make_source({
      tone_pref: { "chat-2": { brevity: "detailed" } },
    }));
    const s = renderer.resolve_style({ session: { warmth: "cool" }, chat_key: "chat-2" });
    expect(s.warmth).toBe("cool");
    expect(s.brevity).toBe("detailed");
  });
});

// ══════════════════════════════════════════
// PersonaMessageRenderer — render: 모든 intent
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — render: formal 스타일", () => {
  let renderer: PersonaMessageRenderer;

  beforeEach(() => {
    renderer = new PersonaMessageRenderer(make_source({ name: "어시스턴트" }));
  });

  it("identity → 이름 포함", () => {
    const r = renderer.render({ kind: "identity" });
    expect(r).toContain("어시스턴트");
  });

  it("safe_fallback → 이름 포함", () => {
    const r = renderer.render({ kind: "safe_fallback" });
    expect(r).toContain("어시스턴트");
  });

  it("error → 사유 포함", () => {
    const r = renderer.render({ kind: "error", reason: "타임아웃" });
    expect(r).toContain("타임아웃");
  });

  it("status_started → 문자열 반환", () => {
    const r = renderer.render({ kind: "status_started" });
    expect(r.length).toBeGreaterThan(0);
  });

  it("status_progress → label 포함", () => {
    const r = renderer.render({ kind: "status_progress", label: "검색 중", tool_count: 3 });
    expect(r).toContain("검색 중");
    expect(r).toContain("3");
  });

  it("status_progress — tool_count=0 → 도구 표시 없음", () => {
    const r = renderer.render({ kind: "status_progress", label: "처리", tool_count: 0 });
    expect(r).not.toContain("도구");
  });

  it("status_completed → ✓ 포함", () => {
    const r = renderer.render({ kind: "status_completed" });
    expect(r).toContain("✓");
  });

  it("inquiry_summary → summary 그대로 반환", () => {
    const r = renderer.render({ kind: "inquiry_summary", summary: "사용자 요청 정리 내용" });
    expect(r).toBe("사용자 요청 정리 내용");
  });

  it("workflow_resume → 포함 문자열 반환", () => {
    const r = renderer.render({ kind: "workflow_resume" });
    expect(r).toContain("진행");
  });

  it("approval_resumed → 승인 포함", () => {
    const r = renderer.render({ kind: "approval_resumed" });
    expect(r).toContain("승인");
  });

  it("approval_resume_failed → 문제 포함", () => {
    const r = renderer.render({ kind: "approval_resume_failed" });
    expect(r).toContain("문제");
  });

  it("expired_task — objective 있음 → 목표 포함", () => {
    const r = renderer.render({ kind: "expired_task", objective: "데이터 분석" });
    expect(r).toContain("데이터 분석");
  });

  it("expired_task — objective 없음 → 만료 표현", () => {
    const r = renderer.render({ kind: "expired_task" });
    expect(r).toContain("만료");
  });

  it("guard_cancelled → 취소 포함", () => {
    const r = renderer.render({ kind: "guard_cancelled" });
    expect(r).toContain("취소");
  });

  it("hitl_prompt(choice) → 헤더 포함", () => {
    const r = renderer.render({ kind: "hitl_prompt", hitl_type: "choice", body: "옵션 선택" });
    expect(r).toContain("선택");
    expect(r).toContain("옵션 선택");
  });

  it("hitl_prompt(escalation) → 판단 포함", () => {
    const r = renderer.render({ kind: "hitl_prompt", hitl_type: "escalation", body: "결정 필요" });
    expect(r).toContain("판단");
  });

  it("hitl_prompt(error) → 오류 포함", () => {
    const r = renderer.render({ kind: "hitl_prompt", hitl_type: "error", body: "에러 발생" });
    expect(r).toContain("오류");
  });

  it("hitl_prompt(confirmation) → 확인 포함", () => {
    const r = renderer.render({ kind: "hitl_prompt", hitl_type: "confirmation", body: "진행할까요?" });
    expect(r).toContain("확인");
  });

  it("hitl_prompt(question) → 질문 포함", () => {
    const r = renderer.render({ kind: "hitl_prompt", hitl_type: "question", body: "선호도는?" });
    expect(r).toContain("질문");
  });

  it("workflow_ask → 질문 형식", () => {
    const r = renderer.render({ kind: "workflow_ask", question: "어떻게 할까요?" });
    expect(r).toContain("어떻게 할까요?");
  });

  it("command_reply → body 그대로 반환", () => {
    const r = renderer.render({ kind: "command_reply", body: "명령 실행 결과입니다." });
    expect(r).toBe("명령 실행 결과입니다.");
  });
});

// ── casual 스타일 ──

describe("PersonaMessageRenderer — render: casual 스타일", () => {
  let renderer: PersonaMessageRenderer;

  beforeEach(() => {
    renderer = new PersonaMessageRenderer(make_source({ name: "테스트봇", heart: "반말로 따뜻하게" }));
  });

  it("identity → 나는 포함", () => {
    const r = renderer.render({ kind: "identity" });
    expect(r).toContain("나는");
  });

  it("workflow_resume → 이어서 포함", () => {
    const r = renderer.render({ kind: "workflow_resume" });
    expect(r).toContain("이어서");
  });

  it("status_started (warm+casual) → 살펴볼게 포함", () => {
    const r = renderer.render({ kind: "status_started" });
    expect(r).toContain("살펴볼게");
  });

  it("hitl_prompt(choice, casual) → 골라줘 포함", () => {
    const r = renderer.render({ kind: "hitl_prompt", hitl_type: "choice", body: "A/B" });
    expect(r).toContain("골라");
  });
});

// ── concept pack 템플릿 override ──

describe("PersonaMessageRenderer — concept pack 템플릿", () => {
  it("fantasy_hero concept → identity 오버라이드", () => {
    const renderer = new PersonaMessageRenderer(make_source({ name: "용사" }));
    const r = renderer.render({ kind: "identity" }, { session: { concept: "fantasy_hero" } });
    expect(r).toContain("용사");
  });

  it("cosmic_observer concept → status_completed 오버라이드", () => {
    const renderer = new PersonaMessageRenderer(make_source({}));
    const r = renderer.render({ kind: "status_completed" }, { session: { concept: "cosmic_observer" } });
    expect(r).toContain("관측 완료");
  });

  it("chunibyo concept → safe_fallback 오버라이드", () => {
    const renderer = new PersonaMessageRenderer(make_source({ name: "마스터" }));
    const r = renderer.render({ kind: "safe_fallback" }, { session: { concept: "chunibyo" } });
    expect(r).toContain("마스터");
  });

  it("adhoc concept → 템플릿 없으므로 기본 렌더링", () => {
    const renderer = new PersonaMessageRenderer(make_source({ name: "봇" }));
    // adhoc: 템플릿은 등록 안 됨 → 기본 렌더링
    const r = renderer.render({ kind: "identity" }, { session: { concept: "adhoc:셜록" } });
    expect(r.length).toBeGreaterThan(0);
  });

  it("concept pack에서 해당 intent 미등록 → 기본 렌더링", () => {
    // fantasy_hero에 없는 intent: inquiry_summary
    const renderer = new PersonaMessageRenderer(make_source({}));
    const r = renderer.render({ kind: "inquiry_summary", summary: "요약" }, { session: { concept: "fantasy_hero" } });
    expect(r).toBe("요약");
  });
});

// ── status_started cool warmth ──

describe("PersonaMessageRenderer — status_started cool warmth", () => {
  it("warmth=cool → '분석 중' 반환", () => {
    const renderer = new PersonaMessageRenderer(make_source({ heart: "사무적으로" }));
    const r = renderer.render({ kind: "status_started" });
    expect(r).toBe("분석 중입니다.");
  });
});

// ══════════════════════════════════════════
// TonePreferenceStore
// ══════════════════════════════════════════

describe("TonePreferenceStore", () => {
  let tmp_dir: string;
  let store_path: string;

  beforeEach(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "tone-pref-"));
    store_path = join(tmp_dir, "tone.json");
  });

  afterEach(async () => {
    await rm(tmp_dir, { recursive: true, force: true });
  });

  it("초기 상태 — 없는 chat_key → 빈 객체", () => {
    const store = new TonePreferenceStore(store_path);
    expect(store.get("chat-unknown")).toEqual({});
  });

  it("set → get → 영속화됨", () => {
    const store = new TonePreferenceStore(store_path);
    store.set("chat-1", { politeness: "casual" });
    expect(store.get("chat-1")).toMatchObject({ politeness: "casual" });
  });

  it("set 두 번 → 기존 필드 유지하며 병합", () => {
    const store = new TonePreferenceStore(store_path);
    store.set("chat-1", { politeness: "casual" });
    store.set("chat-1", { warmth: "cool" });
    const pref = store.get("chat-1");
    expect(pref.politeness).toBe("casual");
    expect(pref.warmth).toBe("cool");
  });

  it("clear → 해당 chat_key 제거", () => {
    const store = new TonePreferenceStore(store_path);
    store.set("chat-1", { politeness: "casual" });
    store.clear("chat-1");
    expect(store.get("chat-1")).toEqual({});
  });

  it("재로드 시 파일에서 복원", () => {
    const store1 = new TonePreferenceStore(store_path);
    store1.set("chat-1", { brevity: "detailed" });
    // 새 인스턴스 생성 → 파일에서 읽기
    const store2 = new TonePreferenceStore(store_path);
    expect(store2.get("chat-1")).toMatchObject({ brevity: "detailed" });
  });

  it("파일 없을 때 로드 → 에러 없이 빈 상태", () => {
    const store = new TonePreferenceStore(join(tmp_dir, "nonexistent.json"));
    expect(store.get("any")).toEqual({});
  });
});
