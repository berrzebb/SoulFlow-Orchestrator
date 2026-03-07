import { describe, it, expect } from "vitest";
import {
  PersonaMessageRenderer,
  parse_tone_override,
  parse_concept_directive,
  get_concept_pack,
  list_concept_packs,
  type PersonaStyleSource,
  type PersonaMessageIntent,
} from "@src/channels/persona-message-renderer.js";

function make_source(overrides?: Partial<PersonaStyleSource>): PersonaStyleSource {
  return {
    get_persona_name: () => "테스트봇",
    get_heart: () => "",
    ...overrides,
  };
}

describe("PersonaMessageRenderer", () => {
  describe("resolve_style", () => {
    it("기본 스타일: formal, warm, short", () => {
      const r = new PersonaMessageRenderer(make_source());
      const s = r.resolve_style();
      expect(s.persona_name).toBe("테스트봇");
      expect(s.politeness).toBe("formal");
      expect(s.warmth).toBe("warm");
      expect(s.brevity).toBe("short");
    });

    it("assistant 이름이면 기본 페르소나로 대체", () => {
      const r = new PersonaMessageRenderer(make_source({ get_persona_name: () => "assistant" }));
      expect(r.resolve_style().persona_name).toBe("비서");
    });

    it("HEART.md에서 casual 힌트 파싱", () => {
      const r = new PersonaMessageRenderer(make_source({ get_heart: () => "반말로 대답해줘" }));
      expect(r.resolve_style().politeness).toBe("casual");
    });

    it("HEART.md에서 cool + detailed 힌트 파싱", () => {
      const r = new PersonaMessageRenderer(make_source({ get_heart: () => "사무적이고 자세하게 설명해줘" }));
      const s = r.resolve_style();
      expect(s.warmth).toBe("cool");
      expect(s.brevity).toBe("detailed");
    });
  });

  describe("render — formal (기본)", () => {
    const r = new PersonaMessageRenderer(make_source());

    it("identity: 페르소나 이름 포함", () => {
      const text = r.render({ kind: "identity" });
      expect(text).toContain("테스트봇");
      expect(text).toContain("도와드릴까요");
    });

    it("safe_fallback: 페르소나 이름 + 재요청", () => {
      const text = r.render({ kind: "safe_fallback" });
      expect(text).toContain("테스트봇");
      expect(text).toContain("이어가겠습니다");
    });

    it("error: 사유 포함", () => {
      const text = r.render({ kind: "error", reason: "API timeout" });
      expect(text).toContain("문제가 발생");
      expect(text).toContain("API timeout");
    });

    it("status_started: warm + formal", () => {
      const text = r.render({ kind: "status_started" });
      expect(text).toContain("살펴보겠습니다");
    });

    it("status_progress: label + tool_count", () => {
      const text = r.render({ kind: "status_progress", label: "파일 검색 중", tool_count: 3 });
      expect(text).toBe("파일 검색 중 (도구 3회)");
    });

    it("status_progress: tool_count 없으면 label만", () => {
      const text = r.render({ kind: "status_progress", label: "분석 중" });
      expect(text).toBe("분석 중");
    });

    it("status_completed", () => {
      expect(r.render({ kind: "status_completed" })).toBe("✓ 완료");
    });

    it("workflow_resume", () => {
      expect(r.render({ kind: "workflow_resume" })).toContain("진행하겠습니다");
    });

    it("approval_resumed", () => {
      const text = r.render({ kind: "approval_resumed" });
      expect(text).toContain("승인");
      expect(text).toContain("진행하겠습니다");
    });

    it("approval_resume_failed", () => {
      expect(r.render({ kind: "approval_resume_failed" })).toContain("문제가 발생");
    });

    it("expired_task: objective 포함", () => {
      const text = r.render({ kind: "expired_task", objective: "뉴스 요약" });
      expect(text).toContain("뉴스 요약");
      expect(text).toContain("만료");
    });

    it("expired_task: objective 없음", () => {
      const text = r.render({ kind: "expired_task" });
      expect(text).toContain("만료");
      expect(text).not.toContain("undefined");
    });

    it("guard_cancelled", () => {
      expect(r.render({ kind: "guard_cancelled" })).toContain("취소");
    });

    it("inquiry_summary: 그대로 반환", () => {
      expect(r.render({ kind: "inquiry_summary", summary: "3개 작업 실행 중" })).toBe("3개 작업 실행 중");
    });
  });

  describe("render — casual", () => {
    const r = new PersonaMessageRenderer(make_source({ get_heart: () => "반말로 편하게" }));

    it("identity: 반말체", () => {
      const text = r.render({ kind: "identity" });
      expect(text).toContain("이야");
      expect(text).toContain("도와줄까");
    });

    it("safe_fallback: 반말체", () => {
      expect(r.render({ kind: "safe_fallback" })).toContain("할게");
    });

    it("error: 반말체", () => {
      expect(r.render({ kind: "error", reason: "timeout" })).toContain("생겼어");
    });

    it("status_started: 반말체", () => {
      expect(r.render({ kind: "status_started" })).toContain("살펴볼게");
    });

    it("workflow_resume: 반말체", () => {
      expect(r.render({ kind: "workflow_resume" })).toContain("진행할게");
    });

    it("guard_cancelled: 반말체", () => {
      expect(r.render({ kind: "guard_cancelled" })).toContain("취소했어");
    });
  });

  describe("render — workspace2 Jin persona (casual + detailed)", () => {
    const heart = "반말. 편하게 말한다. 자세하게: 맥락과 이유를 충분히 설명한다.";
    const r = new PersonaMessageRenderer(make_source({
      get_persona_name: () => "Jin",
      get_heart: () => heart,
    }));

    it("스타일: casual + warm + detailed", () => {
      const s = r.resolve_style();
      expect(s.persona_name).toBe("Jin");
      expect(s.politeness).toBe("casual");
      expect(s.warmth).toBe("warm");
      expect(s.brevity).toBe("detailed");
    });

    it("identity: 반말 + Jin 이름", () => {
      const text = r.render({ kind: "identity" });
      expect(text).toBe("나는 Jin이야. 뭐 도와줄까?");
    });

    it("safe_fallback: 반말", () => {
      const text = r.render({ kind: "safe_fallback" });
      expect(text).toContain("Jin이야");
      expect(text).toContain("할게");
    });

    it("error: 반말", () => {
      const text = r.render({ kind: "error", reason: "API timeout" });
      expect(text).toBe("문제가 생겼어. 사유: API timeout");
    });

    it("status_started: 반말 + warm", () => {
      expect(r.render({ kind: "status_started" })).toBe("바로 살펴볼게.");
    });
  });

  describe("render — cool warmth", () => {
    const r = new PersonaMessageRenderer(make_source({ get_heart: () => "사무적으로" }));

    it("status_started: cool → 분석 중", () => {
      expect(r.render({ kind: "status_started" })).toBe("분석 중입니다.");
    });
  });

  describe("render — command_reply", () => {
    const formal = new PersonaMessageRenderer(make_source());
    const casual = new PersonaMessageRenderer(make_source({ get_heart: () => "반말로 편하게" }));

    it("command_reply: body를 그대로 반환", () => {
      const body = "✅ 확인 가드가 활성화되었습니다.";
      expect(formal.render({ kind: "command_reply", body })).toBe(body);
    });

    it("command_reply: casual에서도 body 그대로 반환", () => {
      const body = "📊 크론 잡 3건 등록됨";
      expect(casual.render({ kind: "command_reply", body })).toBe(body);
    });

    it("command_reply: 빈 body", () => {
      expect(formal.render({ kind: "command_reply", body: "" })).toBe("");
    });
  });

  describe("parse_tone_override", () => {
    it("반말 지시를 감지", () => {
      const o = parse_tone_override("반말로 대답해줘");
      expect(o).not.toBeNull();
      expect(o!.politeness).toBe("casual");
    });

    it("짧게 지시를 감지", () => {
      const o = parse_tone_override("짧게 대답해");
      expect(o).not.toBeNull();
      expect(o!.brevity).toBe("short");
    });

    it("사무적 지시를 감지", () => {
      const o = parse_tone_override("사무적으로 해줘");
      expect(o).not.toBeNull();
      expect(o!.warmth).toBe("cool");
    });

    it("복합 지시 감지", () => {
      const o = parse_tone_override("반말로 자세하게 대답해줘");
      expect(o).not.toBeNull();
      expect(o!.politeness).toBe("casual");
      expect(o!.brevity).toBe("detailed");
    });

    it("톤 지시가 없으면 null", () => {
      expect(parse_tone_override("오늘 날씨 알려줘")).toBeNull();
    });

    it("빈 문자열이면 null", () => {
      expect(parse_tone_override("")).toBeNull();
    });
  });

  describe("render — style_override", () => {
    const r = new PersonaMessageRenderer(make_source());

    it("override로 casual 적용 시 반말체 응답", () => {
      const text = r.render({ kind: "identity" }, { politeness: "casual" });
      expect(text).toContain("이야");
      expect(text).toContain("도와줄까");
    });

    it("override 없으면 기본 formal", () => {
      const text = r.render({ kind: "identity" });
      expect(text).toContain("입니다");
      expect(text).toContain("도와드릴까요");
    });

    it("resolve_style에 override 적용", () => {
      const s = r.resolve_style({ warmth: "cool", brevity: "detailed" });
      expect(s.warmth).toBe("cool");
      expect(s.brevity).toBe("detailed");
      expect(s.politeness).toBe("formal"); // base 유지
    });
  });

  describe("concept pack", () => {
    it("등록된 concept pack 목록이 있다", () => {
      const packs = list_concept_packs();
      expect(packs.length).toBeGreaterThanOrEqual(3);
      expect(packs.map((p: { id: string }) => p.id)).toContain("fantasy_hero");
    });

    it("ID로 concept pack 조회", () => {
      const pack = get_concept_pack("fantasy_hero");
      expect(pack).not.toBeNull();
      expect(pack!.label).toBe("판타지 주인공");
    });

    it("미등록 ID는 null", () => {
      expect(get_concept_pack("nonexistent")).toBeNull();
    });

    it("concept 적용 시 template override 동작", () => {
      const r = new PersonaMessageRenderer(make_source());
      const text = r.render({ kind: "identity" }, { concept: "fantasy_hero" });
      expect(text).toContain("용사");
    });

    it("concept 적용해도 template 미등록 intent는 기본 렌더링", () => {
      const r = new PersonaMessageRenderer(make_source());
      const text = r.render({ kind: "error", reason: "timeout" }, { concept: "fantasy_hero" });
      // fantasy_hero에 error template 없으므로 기본 casual 렌더링
      expect(text).toContain("timeout");
    });

    it("cosmic_observer concept 적용", () => {
      const r = new PersonaMessageRenderer(make_source());
      const text = r.render({ kind: "identity" }, { concept: "cosmic_observer" });
      expect(text).toContain("관측자");
    });

    it("chunibyo concept 적용", () => {
      const r = new PersonaMessageRenderer(make_source());
      const text = r.render({ kind: "status_started" }, { concept: "chunibyo" });
      expect(text).toContain("마법진");
    });
  });

  describe("parse_concept_directive", () => {
    it("등록된 pack label 매칭", () => {
      expect(parse_concept_directive("판타지 주인공처럼 해줘")).toBe("fantasy_hero");
    });

    it("등록된 pack ID 매칭", () => {
      expect(parse_concept_directive("cosmic_observer로 해줘")).toBe("cosmic_observer");
    });

    it("ad-hoc concept: ~처럼 패턴", () => {
      const result = parse_concept_directive("해적 선장처럼 대답해");
      expect(result).toBe("adhoc:해적 선장");
    });

    it("concept 지시 없으면 null", () => {
      expect(parse_concept_directive("오늘 날씨 알려줘")).toBeNull();
    });
  });

  describe("parse_tone_override — concept 포함", () => {
    it("톤 지시 + concept 동시 감지", () => {
      const o = parse_tone_override("반말로 판타지 주인공처럼 해줘");
      expect(o).not.toBeNull();
      expect(o!.politeness).toBe("casual");
      expect(o!.concept).toBe("fantasy_hero");
    });

    it("concept만 감지", () => {
      const o = parse_tone_override("중2병 주인공처럼 대답해");
      expect(o).not.toBeNull();
      expect(o!.concept).toBe("chunibyo");
    });
  });
});
