import { describe, it, expect } from "vitest";
import { compute_prompt_version, stamp_prompt_version } from "@src/agent/prompt-version.ts";

describe("prompt-version", () => {
  it("동일 입력 → 동일 해시", () => {
    const v1 = compute_prompt_version("hello world");
    const v2 = compute_prompt_version("hello world");
    expect(v1).toBe(v2);
  });

  it("다른 입력 → 다른 해시", () => {
    const v1 = compute_prompt_version("hello world");
    const v2 = compute_prompt_version("hello world!");
    expect(v1).not.toBe(v2);
  });

  it("해시 길이 12자", () => {
    const v = compute_prompt_version("test prompt");
    expect(v).toHaveLength(12);
  });

  it("hex 문자만 포함", () => {
    const v = compute_prompt_version("any input");
    expect(v).toMatch(/^[0-9a-f]{12}$/);
  });

  it("stamp_prompt_version — 프롬프트에 버전 주석 첨부", () => {
    const original = "System prompt content";
    const { prompt, version } = stamp_prompt_version(original);

    expect(prompt).toContain(original);
    expect(prompt).toContain(`<!-- prompt_version: ${version} -->`);
    expect(version).toHaveLength(12);
  });

  it("stamp_prompt_version — 버전이 원본 기반", () => {
    const original = "Test prompt";
    const expected_version = compute_prompt_version(original);
    const { version } = stamp_prompt_version(original);
    expect(version).toBe(expected_version);
  });

  it("빈 문자열도 해시 가능", () => {
    const v = compute_prompt_version("");
    expect(v).toHaveLength(12);
  });
});
