/**
 * PersonaMessageRenderer — 미커버 분기 보충.
 * casual_polite 폴리테니스 분기 (identity/safe_fallback/error_msg),
 * casual 폴리테니스: approval_resumed/approval_resume_failed/expired_task/guard_cancelled,
 * status_started warm+formal, resolve_style direct Partial<PersonaStyleSnapshot> 오버라이드,
 * parse_heart_hints casual.polite 패턴, TonePreferenceStore flush dirty=false.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PersonaMessageRenderer,
  TonePreferenceStore,
  parse_tone_override,
} from "@src/channels/persona-message-renderer.js";
import type { PersonaStyleSource, PersonaStyleSnapshot } from "@src/channels/persona-message-renderer.js";

// ── Helper ──

function make_source(
  name = "봇",
  heart = "",
  tone_pref?: Partial<PersonaStyleSnapshot>,
): PersonaStyleSource {
  return {
    get_persona_name: () => name,
    get_heart: () => heart,
    get_tone_preference: tone_pref ? () => tone_pref : undefined,
  };
}

// ══════════════════════════════════════════
// casual_polite — identity / safe_fallback / error_msg
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — casual_polite 폴리테니스", () => {
  it("identity: casual_polite → '이에요' 형태", () => {
    const r = new PersonaMessageRenderer(make_source("알파"));
    const text = r.render({ kind: "identity" }, { session: { politeness: "casual_polite" } });
    expect(text).toContain("알파");
    expect(text).toContain("이에요");
  });

  it("safe_fallback: casual_polite → '이에요' 형태", () => {
    const r = new PersonaMessageRenderer(make_source("알파"));
    const text = r.render({ kind: "safe_fallback" }, { session: { politeness: "casual_polite" } });
    expect(text).toContain("알파");
    expect(text).toContain("이에요");
  });

  it("error_msg: casual_polite → '생겼어요' 형태", () => {
    const r = new PersonaMessageRenderer(make_source("봇"));
    const text = r.render({ kind: "error", reason: "timeout" }, { session: { politeness: "casual_polite" } });
    expect(text).toContain("timeout");
    expect(text).toContain("생겼어요");
  });
});

// ══════════════════════════════════════════
// casual — approval_resumed / approval_resume_failed / guard_cancelled
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — casual 폴리테니스 미커버 intent", () => {
  let renderer: PersonaMessageRenderer;
  beforeEach(() => {
    renderer = new PersonaMessageRenderer(make_source("봇"));
  });

  it("approval_resumed: casual → '했어' 형태", () => {
    const t = renderer.render(
      { kind: "approval_resumed" },
      { session: { politeness: "casual", warmth: "warm" } },
    );
    expect(t).toContain("승인");
    expect(t).toContain("할게");
  });

  it("approval_resume_failed: casual → '있었어' 형태", () => {
    const t = renderer.render(
      { kind: "approval_resume_failed" },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("문제");
    expect(t).toContain("었어");
  });

  it("guard_cancelled: casual → '취소했어' 형태", () => {
    const t = renderer.render(
      { kind: "guard_cancelled" },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("취소");
    expect(t).toContain("어");
  });

  it("expired_task: casual, with objective", () => {
    const t = renderer.render(
      { kind: "expired_task", objective: "데이터 분석" },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("데이터 분석");
    expect(t).toContain("만료됐어");
  });

  it("expired_task: casual, without objective", () => {
    const t = renderer.render(
      { kind: "expired_task" },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("만료됐어");
  });
});

// ══════════════════════════════════════════
// status_started — warm + formal (non-casual)
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — status_started warm+formal", () => {
  it("warmth=warm, politeness=formal → '지금 바로 살펴보겠습니다'", () => {
    const r = new PersonaMessageRenderer(make_source("봇"));
    // DEFAULT_STYLE: warm + formal이므로 오버라이드 없이 바로 확인
    const t = r.render({ kind: "status_started" });
    expect(t).toContain("살펴보겠습니다");
  });
});

// ══════════════════════════════════════════
// resolve_style — direct Partial<PersonaStyleSnapshot> 오버라이드
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — resolve_style direct Partial override", () => {
  it("Partial<PersonaStyleSnapshot> 직접 전달 → session 오버라이드로 처리됨", () => {
    const r = new PersonaMessageRenderer(make_source("봇"));
    // StyleOverrideOptions 아닌 Partial<PersonaStyleSnapshot> 직접 전달
    const style = r.resolve_style({ politeness: "casual" });
    expect(style.politeness).toBe("casual");
  });

  it("render: Partial<PersonaStyleSnapshot> 직접 전달 → casual 스타일 적용됨", () => {
    const r = new PersonaMessageRenderer(make_source("봇"));
    const t = r.render({ kind: "identity" }, { politeness: "casual" });
    expect(t).toContain("나는");
  });
});

// ══════════════════════════════════════════
// parse_heart_hints — casual_polite 패턴
// ══════════════════════════════════════════

describe("parse_tone_override — casual_polite 패턴", () => {
  it("'친근하게' → politeness: casual_polite", () => {
    const r = parse_tone_override("친근하게 말해줘");
    expect(r?.politeness).toBe("casual_polite");
  });

  it("'편안하게' → politeness: casual_polite", () => {
    const r = parse_tone_override("편안하게 부탁해");
    expect(r?.politeness).toBe("casual_polite");
  });
});

// ══════════════════════════════════════════
// TonePreferenceStore — flush dirty=false 경로
// ══════════════════════════════════════════

describe("TonePreferenceStore — flush dirty=false 경로", () => {
  let tmp_dir: string;
  let store_path: string;

  beforeEach(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "persona-tone-"));
    store_path = join(tmp_dir, "tone.json");
  });

  afterEach(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  it("dirty=false 상태에서 flush 호출해도 파일 쓰기 안 함", () => {
    const store = new TonePreferenceStore(store_path);
    // 초기에는 dirty=false — get만 하면 flush 안 됨
    const pref = store.get("chat-1");
    expect(pref).toEqual({});
    // 파일이 쓰이지 않았음을 확인 (파일 없음)
    const { existsSync } = require("node:fs");
    expect(existsSync(store_path)).toBe(false);
  });

  it("set 후 clear → 두 변경 모두 flush됨", async () => {
    const store = new TonePreferenceStore(store_path);
    store.set("chat-1", { politeness: "casual" });
    expect(store.get("chat-1").politeness).toBe("casual");
    store.clear("chat-1");
    expect(store.get("chat-1")).toEqual({});
    // flush가 호출되었는지 파일 존재로 확인
    const { existsSync, readFileSync } = require("node:fs");
    expect(existsSync(store_path)).toBe(true);
    const data = JSON.parse(readFileSync(store_path, "utf-8"));
    expect(data["chat-1"]).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// hitl_prompt — casual key 추가 타입
// ══════════════════════════════════════════

describe("PersonaMessageRenderer — hitl_prompt casual 추가 타입", () => {
  let renderer: PersonaMessageRenderer;
  beforeEach(() => {
    renderer = new PersonaMessageRenderer(make_source("봇"));
  });

  it("hitl_prompt(confirmation, casual) → '확인 필요' 포함", () => {
    const t = renderer.render(
      { kind: "hitl_prompt", hitl_type: "confirmation", body: "계속할까요?" },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("확인 필요");
    expect(t).toContain("계속할까요?");
    expect(t).toContain("답장하면 작업이 재개돼");
  });

  it("hitl_prompt(escalation, casual) → '판단 필요' 포함", () => {
    const t = renderer.render(
      { kind: "hitl_prompt", hitl_type: "escalation", body: "어떻게 할까요?" },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("판단 필요");
  });

  it("hitl_prompt(error, casual) → '오류' 포함", () => {
    const t = renderer.render(
      { kind: "hitl_prompt", hitl_type: "error", body: "실패했습니다." },
      { session: { politeness: "casual" } },
    );
    expect(t).toContain("오류");
  });
});
