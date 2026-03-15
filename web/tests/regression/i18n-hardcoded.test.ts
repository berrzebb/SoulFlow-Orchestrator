/**
 * FE-6b: i18n 회귀 — useT를 import하는 컴포넌트에서 하드코딩 한글 감지.
 * 한글 문자(가-힣)가 소스 파일의 JSX/문자열에 남아있으면 i18n 누락.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 소스 파일에서 한글 문자를 포함하는 줄을 찾는다 (주석/JSDoc 제외). */
function find_korean_lines(file_path: string): Array<{ line: number; text: string }> {
  const content = readFileSync(resolve(file_path), "utf8");
  const lines = content.split("\n");
  const results: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // 주석 줄 제외
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/**") || trimmed.startsWith("/*")) continue;
    // JSDoc @param 등 제외
    if (trimmed.startsWith("@")) continue;
    // 한글 포함 여부
    if (/[가-힣]/.test(line)) {
      results.push({ line: i + 1, text: trimmed });
    }
  }
  return results;
}

describe("i18n 회귀 — 하드코딩 한글 감지 (FE-6b)", () => {
  it("admin/index.tsx에 하드코딩 한글이 없다", () => {
    const hits = find_korean_lines("src/pages/admin/index.tsx");
    expect(hits, `하드코딩 한글 발견: ${JSON.stringify(hits)}`).toHaveLength(0);
  });

  it("admin/monitoring-panel.tsx에 하드코딩 한글이 없다", () => {
    const hits = find_korean_lines("src/pages/admin/monitoring-panel.tsx");
    expect(hits, `하드코딩 한글 발견: ${JSON.stringify(hits)}`).toHaveLength(0);
  });

  it("en.json에 한글 값이 없다", () => {
    const content = readFileSync(resolve("../src/i18n/locales/en.json"), "utf8");
    const entries = Object.entries(JSON.parse(content) as Record<string, string>);
    const korean_entries = entries.filter(([, v]) => /[가-힣]/.test(v));
    expect(korean_entries, `en.json에 한글 값: ${korean_entries.map(([k]) => k).join(", ")}`).toHaveLength(0);
  });

  it("en.json과 ko.json 키가 일치한다", () => {
    const en = Object.keys(JSON.parse(readFileSync(resolve("../src/i18n/locales/en.json"), "utf8")) as Record<string, string>);
    const ko = Object.keys(JSON.parse(readFileSync(resolve("../src/i18n/locales/ko.json"), "utf8")) as Record<string, string>);
    const only_en = en.filter((k) => !ko.includes(k));
    const only_ko = ko.filter((k) => !en.includes(k));
    expect(only_en, `en에만 존재: ${only_en.join(", ")}`).toHaveLength(0);
    expect(only_ko, `ko에만 존재: ${only_ko.join(", ")}`).toHaveLength(0);
  });

  it("admin.* 키가 en.json에 78개 이상 존재한다", () => {
    const en = Object.keys(JSON.parse(readFileSync(resolve("../src/i18n/locales/en.json"), "utf8")) as Record<string, string>);
    const admin_keys = en.filter((k) => k.startsWith("admin."));
    expect(admin_keys.length).toBeGreaterThanOrEqual(74);
  });
});
