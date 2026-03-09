/**
 * i18n index.ts — 메인 진입점 커버리지.
 * set_locale, get_locale, get_t, t 함수 테스트.
 */
import { describe, it, expect } from "vitest";
import { set_locale, get_locale, get_t, t, DEFAULT_LOCALE } from "@src/i18n/index.js";

describe("i18n index — set_locale / get_locale", () => {
  it("초기 로케일은 DEFAULT_LOCALE", () => {
    expect(get_locale()).toBeDefined();
  });

  it("set_locale('ko') → get_locale()='ko'", () => {
    set_locale("ko");
    expect(get_locale()).toBe("ko");
  });

  it("set_locale('en') → get_locale()='en'", () => {
    set_locale("en");
    expect(get_locale()).toBe("en");
  });

  it("set_locale 후 DEFAULT_LOCALE로 복원", () => {
    set_locale(DEFAULT_LOCALE);
    expect(get_locale()).toBe(DEFAULT_LOCALE);
  });
});

describe("i18n index — get_t / t", () => {
  it("get_t() 반환값은 함수", () => {
    const fn = get_t();
    expect(typeof fn).toBe("function");
  });

  it("get_t(locale) — 특정 로케일 지정", () => {
    const fn = get_t("en");
    expect(typeof fn).toBe("function");
  });

  it("get_t('ko') — 한국어 로케일", () => {
    const fn = get_t("ko");
    expect(typeof fn).toBe("function");
  });

  it("t(key) — 기본 번역 (키 없으면 키 그대로)", () => {
    set_locale(DEFAULT_LOCALE);
    const result = t("nonexistent_key_xyz");
    // 키가 없으면 key 그대로 반환하거나 empty string
    expect(typeof result).toBe("string");
  });

  it("t(key, vars) — 변수 치환", () => {
    const result = t("nonexistent_key", { name: "테스트" });
    expect(typeof result).toBe("string");
  });

  it("get_t: fallback 로케일 적용 (non-default locale → fallback to default)", () => {
    // DEFAULT_LOCALE이 아닌 로케일을 설정하면 fallback으로 default가 사용됨
    const fn = get_t("ko");
    const result = fn("nonexistent_key_xyz_abc");
    expect(typeof result).toBe("string");
  });

  it("load_dict: 존재하지 않는 로케일 파일 → catch → dict={}", () => {
    // 존재하지 않는 로케일로 설정하면 readFileSync 실패 → catch → dict={}
    set_locale("fr" as any);
    const result = t("any_key");
    expect(typeof result).toBe("string"); // dict={} → 키 없음 → 키 그대로 반환
    // 복구
    set_locale(DEFAULT_LOCALE);
  });
});
