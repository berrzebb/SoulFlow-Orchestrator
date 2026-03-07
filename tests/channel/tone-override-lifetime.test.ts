/**
 * D1 회귀 테스트 — current-turn tone override 수명 검증.
 *
 * current-turn override는 해당 요청의 응답까지만 적용되고,
 * 다음 턴에는 persistent preference만 남아야 한다.
 */
import { describe, it, expect, afterEach } from "vitest";
import { create_harness, inbound, type Harness } from "@helpers/harness.ts";
import type { PersonaMessageIntent, PersonaStyleSnapshot, StyleOverrideOptions } from "@src/channels/persona-message-renderer.ts";

type RenderCall = { intent: PersonaMessageIntent; overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions };

function make_spy_renderer() {
  const calls: RenderCall[] = [];
  return {
    calls,
    renderer: {
      render(intent: PersonaMessageIntent, overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): string {
        calls.push({ intent, overrides });
        if (intent.kind === "error") return `에러: ${intent.reason}`;
        if (intent.kind === "status_progress") return intent.label;
        if (intent.kind === "command_reply") return intent.body;
        return `[${intent.kind}]`;
      },
      resolve_style(overrides?: Partial<PersonaStyleSnapshot> | StyleOverrideOptions): PersonaStyleSnapshot {
        return {
          persona_name: "테스트봇",
          language: "ko",
          politeness: "formal",
          warmth: "warm",
          brevity: "short",
          ...(overrides && "session" in overrides ? overrides.session : overrides),
        } as PersonaStyleSnapshot;
      },
    },
  };
}

/** tone_overrides Map에 직접 접근 (테스트 전용). */
function get_tone_overrides(manager: unknown): Map<string, unknown> {
  return (manager as Record<string, unknown>).tone_overrides as Map<string, unknown>;
}

describe("tone override lifetime (D1)", () => {
  let harness: Harness;

  afterEach(async () => { await harness?.cleanup(); });

  it("current-turn override는 해당 턴 종료 후 Map에서 삭제된다", async () => {
    const spy = make_spy_renderer();
    harness = await create_harness({ renderer: spy.renderer });
    const overrides = get_tone_overrides(harness.manager);

    expect(overrides.size).toBe(0);

    await harness.manager.handle_inbound_message("telegram", inbound("반말로 대답해줘 오늘 날씨"));

    // 턴 종료 후: override 삭제됨
    expect(overrides.size).toBe(0);
  });

  it("tone override 없는 메시지는 Map에 항목을 남기지 않는다", async () => {
    const spy = make_spy_renderer();
    harness = await create_harness({ renderer: spy.renderer });
    const overrides = get_tone_overrides(harness.manager);

    await harness.manager.handle_inbound_message("telegram", inbound("안녕하세요"));
    expect(overrides.size).toBe(0);
  });

  it("에러 발생 시에도 override가 정리된다", async () => {
    const spy = make_spy_renderer();
    harness = await create_harness({
      renderer: spy.renderer,
      orchestration_handler: async () => { throw new Error("test error"); },
    });
    const overrides = get_tone_overrides(harness.manager);

    await harness.manager.handle_inbound_message("telegram", inbound("반말로 해줘 이거 실행해"));
    expect(overrides.size).toBe(0);
  });

  it("연속 두 턴에서 첫 턴의 override가 두 번째 턴의 Map에 누수되지 않는다", async () => {
    harness = await create_harness();
    const overrides = get_tone_overrides(harness.manager);

    // 턴 1: override 포함
    await harness.manager.handle_inbound_message("telegram", inbound("반말로 해줘 테스트"));
    expect(overrides.size).toBe(0);

    // 턴 2: override 없는 일반 메시지
    await harness.manager.handle_inbound_message("telegram", inbound("다시 해줘"));
    expect(overrides.size).toBe(0);
  });
});
