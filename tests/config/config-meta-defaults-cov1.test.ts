/**
 * config-meta default_value vs schema defaults 일치 검증 (C-18).
 *
 * config-meta.ts의 default_value는 UI 표시용 메타데이터.
 * 실제 기본값은 schema.ts get_config_defaults()에서 옴.
 * 두 값이 어긋나면 관리자가 UI에서 본 기본값을 신뢰할 수 없음.
 */
import { describe, it, expect } from "vitest";
import { CONFIG_FIELDS } from "@src/config/config-meta.js";
import { get_config_defaults } from "@src/config/schema.js";

/** 점 구분 경로로 중첩 객체 값 조회. */
function get_nested(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur !== null && typeof cur === "object") {
      return (cur as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

describe("config-meta default_value — schema 기본값과 일치 (C-18)", () => {
  const defaults = get_config_defaults() as unknown as Record<string, unknown>;

  it("memory.consolidation.enabled 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.consolidation.enabled");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.consolidation.enabled"));
  });

  it("memory.consolidation.idleAfterMs 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.consolidation.idleAfterMs");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.consolidation.idleAfterMs"));
  });

  it("memory.consolidation.archiveUsed 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.consolidation.archiveUsed");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.consolidation.archiveUsed"));
  });

  it("memory.consolidation.windowDays 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.consolidation.windowDays");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.consolidation.windowDays"));
  });

  it("memory.longtermInjectionMaxChars 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.longtermInjectionMaxChars");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.longtermInjectionMaxChars"));
  });

  it("memory.dailyInjectionDays 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.dailyInjectionDays");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.dailyInjectionDays"));
  });

  it("memory.dailyInjectionMaxChars 기본값 일치", () => {
    const field = CONFIG_FIELDS.find((f) => f.path === "memory.dailyInjectionMaxChars");
    expect(field?.default_value).toBe(get_nested(defaults, "memory.dailyInjectionMaxChars"));
  });
});
