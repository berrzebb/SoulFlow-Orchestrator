/**
 * PersonaMessageRenderer — ConceptPack template 커버리지 (cov3):
 * - fantasy_hero: safe_fallback, status_started, status_completed, guard_cancelled
 * - cosmic_observer: safe_fallback, status_started, guard_cancelled
 * - chunibyo: safe_fallback, status_started, guard_cancelled
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersonaMessageRenderer, TonePreferenceStore } from "@src/channels/persona-message-renderer.js";
import type { PersonaStyleSource, PersonaStyleSnapshot } from "@src/channels/persona-message-renderer.js";

function make_source(name = "사이버봇"): PersonaStyleSource {
  return {
    get_persona_name: () => name,
    get_heart: () => "",
  };
}

function make_renderer(name = "사이버봇") {
  return new PersonaMessageRenderer(make_source(name));
}

function with_concept(concept: string): Partial<PersonaStyleSnapshot> {
  return { concept };
}

// ══════════════════════════════════════════════════════════
// fantasy_hero
// ══════════════════════════════════════════════════════════

describe("ConceptPack — fantasy_hero templates", () => {
  const r = make_renderer("영웅");
  const ov = with_concept("fantasy_hero");

  it("safe_fallback → 용사 말투", () => {
    const msg = r.render({ kind: "safe_fallback" }, { session: ov });
    expect(msg).toContain("영웅");
    expect(msg).toContain("외쳐주라");
  });

  it("status_started → 검을 들었다", () => {
    const msg = r.render({ kind: "status_started" }, { session: ov });
    expect(msg).toContain("검을 들었다");
  });

  it("status_completed → 임무 완료", () => {
    const msg = r.render({ kind: "status_completed" }, { session: ov });
    expect(msg).toContain("임무 완료");
  });

  it("guard_cancelled → 퇴각 명령", () => {
    const msg = r.render({ kind: "guard_cancelled" }, { session: ov });
    expect(msg).toContain("퇴각");
  });
});

// ══════════════════════════════════════════════════════════
// cosmic_observer
// ══════════════════════════════════════════════════════════

describe("ConceptPack — cosmic_observer templates", () => {
  const r = make_renderer("관측자");
  const ov = with_concept("cosmic_observer");

  it("safe_fallback → 신호가 불분명합니다", () => {
    const msg = r.render({ kind: "safe_fallback" }, { session: ov });
    expect(msg).toContain("신호가 불분명합니다");
  });

  it("status_started → 관측을 개시합니다", () => {
    const msg = r.render({ kind: "status_started" }, { session: ov });
    expect(msg).toContain("관측을 개시합니다");
  });

  it("guard_cancelled → 관측이 중단되었습니다", () => {
    const msg = r.render({ kind: "guard_cancelled" }, { session: ov });
    expect(msg).toContain("관측이 중단되었습니다");
  });
});

// ══════════════════════════════════════════════════════════
// chunibyo
// ══════════════════════════════════════════════════════════

describe("ConceptPack — chunibyo templates", () => {
  const r = make_renderer("봉인자");
  const ov = with_concept("chunibyo");

  it("safe_fallback → 마력이 불안정하다", () => {
    const msg = r.render({ kind: "safe_fallback" }, { session: ov });
    expect(msg).toContain("마력이 불안정하다");
  });

  it("status_started → 금지된 마법진", () => {
    const msg = r.render({ kind: "status_started" }, { session: ov });
    expect(msg).toContain("마법진");
  });

  it("guard_cancelled → 이번엔 내가 물러서겠다", () => {
    const msg = r.render({ kind: "guard_cancelled" }, { session: ov });
    expect(msg).toContain("물러서겠다");
  });

  it("identity → 봉인된 힘 (L122)", () => {
    const msg = r.render({ kind: "identity" }, { session: ov });
    expect(msg).toContain("봉인된");
  });

  it("status_completed → 봉인 해제 완료 (L125)", () => {
    const msg = r.render({ kind: "status_completed" }, { session: ov });
    expect(msg).toContain("봉인 해제");
  });
});

// ══════════════════════════════════════════════════════════
// TonePreferenceStore — flush dirty=false (L407)
// ══════════════════════════════════════════════════════════

describe("TonePreferenceStore — flush dirty=false early return (L407)", () => {
  let tmp_dir: string;
  let store_path: string;

  beforeAll(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "persona-flush-"));
    store_path = join(tmp_dir, "tone.json");
  });

  afterAll(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  it("dirty=false일 때 flush() 직접 호출 → 즉시 return (L407)", () => {
    const store = new TonePreferenceStore(store_path);
    // 새 인스턴스는 dirty=false — flush를 직접 호출하면 L407 early return
    (store as any).flush();
    // 파일이 만들어지지 않았음 (dirty=false → early return)
    const { existsSync } = require("node:fs");
    expect(existsSync(store_path)).toBe(false);
  });
});
