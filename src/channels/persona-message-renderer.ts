import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * PersonaMessageRenderer — 모든 사용자-facing 발화를 페르소나 규칙에 맞게 렌더링.
 *
 * 의미(intent)와 표현(style)을 분리한다.
 * - 의미: PersonaMessageIntent (identity, safe_fallback, error, status_*, ...)
 * - 표현: PersonaStyleSnapshot (persona_name, politeness, warmth, brevity, ...)
 *
 * Phase 1: identity, safe_fallback, error, status_started/progress/completed
 */

// ── Intent ──

export type PersonaMessageIntent =
  | { kind: "identity" }
  | { kind: "safe_fallback" }
  | { kind: "error"; reason: string }
  | { kind: "status_started" }
  | { kind: "status_progress"; label: string; tool_count?: number }
  | { kind: "status_completed" }
  | { kind: "inquiry_summary"; summary: string }
  | { kind: "workflow_resume" }
  | { kind: "approval_resumed" }
  | { kind: "approval_resume_failed" }
  | { kind: "expired_task"; objective?: string }
  | { kind: "guard_cancelled" }
  | { kind: "hitl_prompt"; hitl_type: "choice" | "confirmation" | "question" | "escalation" | "error"; body: string }
  | { kind: "workflow_ask"; question: string }
  | { kind: "command_reply"; body: string };

// ── Style ──

export type Politeness = "formal" | "casual_polite" | "casual";
export type Warmth = "warm" | "neutral" | "cool";
export type Brevity = "short" | "normal" | "detailed";

export type PersonaStyleSnapshot = {
  persona_name: string;
  language: "ko" | "en";
  politeness: Politeness;
  warmth: Warmth;
  brevity: Brevity;
  /** concept pack ID 또는 ad-hoc concept brief. */
  concept?: string;
};

// ── Style source ──

export type PersonaStyleSource = {
  get_persona_name(): string;
  get_heart(): string;
  /** 채팅별 영속 톤 선호. 미구현 시 빈 객체 반환. */
  get_tone_preference?(chat_key: string): Partial<PersonaStyleSnapshot>;
};

// ── Renderer ──

export type StyleOverrideOptions = {
  /** current-turn session override (가장 높은 우선순위). */
  session?: Partial<PersonaStyleSnapshot>;
  /** 채팅별 영속 선호를 조회할 키. */
  chat_key?: string;
};

export interface PersonaMessageRendererLike {
  render(intent: PersonaMessageIntent, overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): string;
  resolve_style(overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): PersonaStyleSnapshot;
}

const DEFAULT_STYLE: PersonaStyleSnapshot = {
  persona_name: "비서",
  language: "ko",
  politeness: "formal",
  warmth: "warm",
  brevity: "short",
};

// ── Concept Pack ──

export type ConceptPack = {
  id: string;
  /** 사용자-facing 이름. */
  label: string;
  /** 기본 스타일 프리셋. */
  style: Partial<PersonaStyleSnapshot>;
  /** intent별 메시지 오버라이드. 미지정 intent는 기본 템플릿 사용. */
  templates?: Partial<Record<PersonaMessageIntent["kind"], (s: PersonaStyleSnapshot) => string>>;
};

const CONCEPT_PACKS: ConceptPack[] = [
  {
    id: "fantasy_hero",
    label: "판타지 주인공",
    style: { politeness: "casual", warmth: "warm", brevity: "normal" },
    templates: {
      identity: (s) => `나는 ${s.persona_name}, 이 세계의 용사다. 무엇이든 맡겨라!`,
      safe_fallback: (s) => `${s.persona_name}이다. 한 번 더 외쳐주라, 바로 달려가겠다!`,
      status_started: () => "검을 들었다. 탐색을 시작한다!",
      status_completed: () => "⚔️ 임무 완료!",
      guard_cancelled: () => "퇴각 명령이다. 작전을 취소했다.",
    },
  },
  {
    id: "cosmic_observer",
    label: "우주의 관찰자",
    style: { politeness: "formal", warmth: "cool", brevity: "normal" },
    templates: {
      identity: (s) => `관측자 ${s.persona_name}. 당신의 질의를 기다리고 있었습니다.`,
      safe_fallback: (s) => `관측자 ${s.persona_name}. 신호가 불분명합니다. 다시 전송해주십시오.`,
      status_started: () => "관측을 개시합니다.",
      status_completed: () => "🌌 관측 완료.",
      guard_cancelled: () => "관측이 중단되었습니다.",
    },
  },
  {
    id: "chunibyo",
    label: "중2병 주인공",
    style: { politeness: "casual", warmth: "warm", brevity: "detailed" },
    templates: {
      identity: (s) => `크크크... 나는 ${s.persona_name}. 봉인된 힘이 깨어나고 있다... 무엇을 원하지?`,
      safe_fallback: (s) => `${s.persona_name}의 마력이 불안정하다... 다시 한 번 주문을 외워줘.`,
      status_started: () => "금지된 마법진이 가동된다...!",
      status_completed: () => "🔮 ...봉인 해제 완료.",
      guard_cancelled: () => "...크, 이번엔 내가 물러서겠다.",
    },
  },
];

const CONCEPT_PACK_MAP = new Map<string, ConceptPack>(CONCEPT_PACKS.map((p) => [p.id, p]));

/** concept pack ID로 조회. */
export function get_concept_pack(id: string): ConceptPack | null {
  return CONCEPT_PACK_MAP.get(id) ?? null;
}

/** 등록된 concept pack 목록. */
export function list_concept_packs(): ConceptPack[] {
  return [...CONCEPT_PACKS];
}

/** 사용자 입력에서 concept 지시를 추출. */
export function parse_concept_directive(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  // 등록된 pack label 매칭
  for (const pack of CONCEPT_PACKS) {
    if (lower.includes(pack.label) || lower.includes(pack.id)) return pack.id;
  }
  // ad-hoc: "~처럼", "~같이" 패턴
  const m = text.match(/(.{2,20}?)(?:처럼|같이|스타일로)\s*(?:해줘|대답해|말해)?/);
  if (m) return `adhoc:${m[1].trim()}`;
  return null;
}

/** HEART.md에서 기본 스타일 힌트를 추출. */
function parse_heart_hints(heart: string): Partial<PersonaStyleSnapshot> {
  if (!heart) return {};
  const lower = heart.toLowerCase();
  const hints: Partial<PersonaStyleSnapshot> = {};
  if (/반말|casual|편하게/.test(lower)) hints.politeness = "casual";
  else if (/친근|casual.polite|편안/.test(lower)) hints.politeness = "casual_polite";
  if (/차가운|cool|사무적|딱딱/.test(lower)) hints.warmth = "cool";
  else if (/따뜻|warm|친절/.test(lower)) hints.warmth = "warm";
  if (/짧게|간결|short|brief/.test(lower)) hints.brevity = "short";
  else if (/자세|detailed|장문/.test(lower)) hints.brevity = "detailed";
  return hints;
}

export class PersonaMessageRenderer implements PersonaMessageRendererLike {
  constructor(private readonly source: PersonaStyleSource) {}

  resolve_style(overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): PersonaStyleSnapshot {
    const persona = this.source.get_persona_name();
    const name = persona && persona !== "assistant" ? persona : "비서";
    const heart_hints = parse_heart_hints(this.source.get_heart());
    let style: PersonaStyleSnapshot = { ...DEFAULT_STYLE, ...heart_hints, persona_name: name };

    if (!overrides) return style;

    const opts = normalize_overrides(overrides);

    // 계층: HEART(base) → persistent preference → session override
    if (opts.chat_key && this.source.get_tone_preference) {
      const pref = this.source.get_tone_preference(opts.chat_key);
      if (pref) style = { ...style, ...strip_undefined(pref) };
    }
    if (opts.session) {
      style = { ...style, ...strip_undefined(opts.session) };
    }

    return style;
  }

  render(intent: PersonaMessageIntent, overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): string {
    const style = this.resolve_style(overrides);
    return render_intent(intent, style);
  }
}

// ── Render logic ──

function render_intent(intent: PersonaMessageIntent, s: PersonaStyleSnapshot): string {
  // concept pack template override.
  // adhoc: concept는 등록된 템플릿이 없으므로 deterministic 메시지에는 미적용.
  // adhoc concept의 문체 반영은 LLM system prompt 계층에서 처리한다.
  if (s.concept && !s.concept.startsWith("adhoc:")) {
    const pack = CONCEPT_PACK_MAP.get(s.concept);
    const tpl = pack?.templates?.[intent.kind];
    if (tpl) return tpl(s);
  }

  switch (intent.kind) {
    case "identity":
      return identity(s);
    case "safe_fallback":
      return safe_fallback(s);
    case "error":
      return error_msg(intent.reason, s);
    case "status_started":
      return status_started(s);
    case "status_progress":
      return status_progress(intent.label, intent.tool_count, s);
    case "status_completed":
      return status_completed(s);
    case "inquiry_summary":
      return intent.summary;
    case "workflow_resume":
      return workflow_resume(s);
    case "approval_resumed":
      return approval_resumed(s);
    case "approval_resume_failed":
      return approval_resume_failed(s);
    case "expired_task":
      return expired_task(intent.objective, s);
    case "guard_cancelled":
      return guard_cancelled(s);
    case "hitl_prompt":
      return hitl_prompt(intent.hitl_type, intent.body, s);
    case "workflow_ask":
      return workflow_ask(intent.question, s);
    case "command_reply":
      // 최종 정책: 커맨드 응답은 핸들러가 생성한 본문을 그대로 전달한다.
      // tone surface 재작성은 정보성 메시지의 가독성을 해치므로 적용하지 않는다.
      return intent.body;
  }
}

// ── Surface templates ──

function identity(s: PersonaStyleSnapshot): string {
  const q = question_suffix(s);
  switch (s.politeness) {
    case "formal": return `저는 ${s.persona_name}입니다. ${q}`;
    case "casual_polite": return `저는 ${s.persona_name}이에요. ${q}`;
    case "casual": return `나는 ${s.persona_name}이야. ${q}`;
  }
}

function safe_fallback(s: PersonaStyleSnapshot): string {
  switch (s.politeness) {
    case "formal": return `${s.persona_name}입니다. 요청을 한 번 더 말씀해주시면 바로 이어가겠습니다.`;
    case "casual_polite": return `${s.persona_name}이에요. 다시 한 번 말씀해주시면 바로 이어갈게요.`;
    case "casual": return `${s.persona_name}이야. 다시 한 번 말해주면 바로 할게.`;
  }
}

function error_msg(reason: string, s: PersonaStyleSnapshot): string {
  switch (s.politeness) {
    case "formal": return `처리 중 문제가 발생했습니다. 사유: ${reason}`;
    case "casual_polite": return `처리 중에 문제가 생겼어요. 사유: ${reason}`;
    case "casual": return `문제가 생겼어. 사유: ${reason}`;
  }
}

function status_started(s: PersonaStyleSnapshot): string {
  if (s.warmth === "warm") {
    return s.politeness === "casual" ? "바로 살펴볼게." : "지금 바로 살펴보겠습니다.";
  }
  return "분석 중입니다.";
}

function status_progress(label: string, tool_count: number | undefined, _s: PersonaStyleSnapshot): string {
  const tc = tool_count !== null && tool_count !== undefined && tool_count > 0 ? ` (도구 ${tool_count}회)` : "";
  return `${label}${tc}`;
}

function status_completed(_s: PersonaStyleSnapshot): string {
  return "✓ 완료";
}

function workflow_resume(s: PersonaStyleSnapshot): string {
  return s.politeness === "casual" ? "이어서 진행할게." : "이어서 진행하겠습니다.";
}

function approval_resumed(s: PersonaStyleSnapshot): string {
  return s.politeness === "casual" ? "승인 확인했어, 이어서 진행할게." : "승인이 확인되었습니다. 이어서 진행하겠습니다.";
}

function approval_resume_failed(s: PersonaStyleSnapshot): string {
  return s.politeness === "casual" ? "승인 처리에 문제가 있었어." : "승인 처리 중 문제가 발생했습니다.";
}

function expired_task(objective: string | undefined, s: PersonaStyleSnapshot): string {
  const task_label = objective ? ` (${objective})` : "";
  return s.politeness === "casual"
    ? `이전 작업${task_label}이 만료됐어.`
    : `이전 작업${task_label}이 만료되었습니다.`;
}

function guard_cancelled(s: PersonaStyleSnapshot): string {
  return s.politeness === "casual" ? "작업을 취소했어." : "작업이 취소되었습니다.";
}

type HitlType = "choice" | "confirmation" | "question" | "escalation" | "error";

const HITL_HEADERS: Record<HitlType, { formal: string; casual: string }> = {
  choice:       { formal: "💬 **선택 요청**", casual: "💬 **골라줘**" },
  confirmation: { formal: "💬 **확인 요청**", casual: "💬 **확인 필요**" },
  question:     { formal: "💬 **질문**", casual: "💬 **질문**" },
  escalation:   { formal: "⚠️ **판단 요청**", casual: "⚠️ **판단 필요**" },
  error:        { formal: "❌ **오류 발생**", casual: "❌ **오류**" },
};

const HITL_INSTRUCTIONS: Record<HitlType, { formal: string; casual: string }> = {
  choice:       { formal: "위 선택지 중 하나를 골라 답장해주세요.", casual: "위에서 하나 골라서 답장해줘." },
  confirmation: { formal: "진행하시려면 '네', 취소하시려면 '아니오'로 답장해주세요.", casual: "'네' 또는 '아니오'로 답장해줘." },
  question:     { formal: "질문에 대한 답변을 답장해주세요.", casual: "답변을 답장해줘." },
  escalation:   { formal: "판단이 필요합니다. 답장으로 지시해주세요.", casual: "어떻게 할지 답장해줘." },
  error:        { formal: "오류가 발생했습니다. 재시도하시려면 답장해주세요.", casual: "오류 났어. 다시 하려면 답장해줘." },
};

function hitl_prompt(type: HitlType, body: string, s: PersonaStyleSnapshot): string {
  const key = s.politeness === "casual" ? "casual" : "formal";
  const header = HITL_HEADERS[type][key];
  const instruction = HITL_INSTRUCTIONS[type][key];
  const footer = s.politeness === "casual"
    ? "_답장하면 작업이 재개돼._"
    : "_이 메시지에 답장하면 작업이 자동으로 재개됩니다._";
  return [header, "", body, "", instruction, "", footer].join("\n");
}

function workflow_ask(question: string, s: PersonaStyleSnapshot): string {
  return hitl_prompt("question", question, s);
}

function question_suffix(s: PersonaStyleSnapshot): string {
  switch (s.politeness) {
    case "formal": return "무엇을 도와드릴까요?";
    case "casual_polite": return "무엇을 도와드릴까요?";
    case "casual": return "뭐 도와줄까?";
  }
}

// ── Tone override ──

/** 사용자 입력에서 current-turn 톤 지시를 추출. 톤 지시가 없으면 null. */
export function parse_tone_override(text: string): Partial<PersonaStyleSnapshot> | null {
  if (!text) return null;
  const hints = parse_heart_hints(text);
  const concept = parse_concept_directive(text);
  if (concept) hints.concept = concept;
  return Object.keys(hints).length > 0 ? hints : null;
}

// ── Persistent tone preference store ──

/** 채팅별 톤 선호를 파일 기반으로 영속화. */
export class TonePreferenceStore {
  private cache = new Map<string, Partial<PersonaStyleSnapshot>>();
  private dirty = false;

  constructor(private readonly file_path: string) {
    this.load();
  }

  get(chat_key: string): Partial<PersonaStyleSnapshot> {
    return this.cache.get(chat_key) || {};
  }

  set(chat_key: string, pref: Partial<PersonaStyleSnapshot>): void {
    const existing = this.cache.get(chat_key) || {};
    this.cache.set(chat_key, { ...existing, ...strip_undefined(pref) });
    this.dirty = true;
    this.flush();
  }

  clear(chat_key: string): void {
    this.cache.delete(chat_key);
    this.dirty = true;
    this.flush();
  }

  private load(): void {
    try {
      const data = JSON.parse(readFileSync(this.file_path, "utf-8"));
      if (data && typeof data === "object") {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object") this.cache.set(k, v as Partial<PersonaStyleSnapshot>);
        }
      }
    } catch { /* file not found or invalid — start fresh */ }
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.file_path), { recursive: true });
      writeFileSync(this.file_path, JSON.stringify(Object.fromEntries(this.cache), null, 2));
      this.dirty = false;
    } catch { /* best-effort persist */ }
  }
}

function is_style_override_options(v: unknown): v is StyleOverrideOptions {
  return typeof v === "object" && v !== null && ("session" in v || "chat_key" in v);
}

function normalize_overrides(v: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): StyleOverrideOptions {
  if (is_style_override_options(v)) return v;
  return { session: v };
}

function strip_undefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
