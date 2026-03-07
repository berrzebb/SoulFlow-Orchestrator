import { describe, it, expect } from "vitest";
import { create_t, parse_locale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@src/i18n/protocol.js";

describe("create_t", () => {
  const dict = { "hello": "안녕", "greeting": "Hello, {name}!" };
  const fallback = { "hello": "Hi", "missing_in_dict": "fallback value" };

  it("returns translated value", () => {
    const t = create_t(dict);
    expect(t("hello")).toBe("안녕");
  });

  it("interpolates variables", () => {
    const t = create_t(dict);
    expect(t("greeting", { name: "Alice" })).toBe("Hello, Alice!");
  });

  it("falls back to fallback dict when key missing", () => {
    const t = create_t(dict, fallback);
    expect(t("missing_in_dict")).toBe("fallback value");
  });

  it("returns key itself when not found in any dict", () => {
    const t = create_t(dict, fallback);
    expect(t("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("interpolates numeric variables", () => {
    const t = create_t({ "count": "{n} items" });
    expect(t("count", { n: 42 })).toBe("42 items");
  });

  it("handles multiple variable replacements", () => {
    const t = create_t({ "msg": "{a} and {b}" });
    expect(t("msg", { a: "x", b: "y" })).toBe("x and y");
  });
});

describe("parse_locale", () => {
  it("returns en for 'en'", () => {
    expect(parse_locale("en")).toBe("en");
  });

  it("returns ko for 'ko'", () => {
    expect(parse_locale("ko")).toBe("ko");
  });

  it("returns default for unsupported locale", () => {
    expect(parse_locale("ja")).toBe(DEFAULT_LOCALE);
    expect(parse_locale("fr")).toBe(DEFAULT_LOCALE);
  });

  it("returns default for non-string values", () => {
    expect(parse_locale(null)).toBe(DEFAULT_LOCALE);
    expect(parse_locale(undefined)).toBe(DEFAULT_LOCALE);
    expect(parse_locale(123)).toBe(DEFAULT_LOCALE);
  });
});

describe("SUPPORTED_LOCALES", () => {
  it("contains en and ko", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("ko");
  });
});
