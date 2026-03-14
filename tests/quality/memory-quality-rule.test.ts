import { describe, it, expect } from "vitest";
import {
  audit_memory_entry,
  audit_memory_entries,
  type MemoryQualityRule,
} from "@src/quality/memory-quality-rule.ts";

// ── 빈 항목 ──────────────────────────────────────────────────────────────────

describe("audit_memory_entry — 빈 항목", () => {
  it("빈 문자열 → empty_content [major], passed: false", () => {
    const r = audit_memory_entry({ content: "" });
    expect(r.passed).toBe(false);
    expect(r.violations[0].code).toBe("empty_content");
    expect(r.violations[0].severity).toBe("major");
  });

  it("공백만 → empty_content [major]", () => {
    const r = audit_memory_entry({ content: "   \n  " });
    expect(r.passed).toBe(false);
    expect(r.violations[0].code).toBe("empty_content");
  });
});

// ── too_long ──────────────────────────────────────────────────────────────────

describe("audit_memory_entry — too_long 위반", () => {
  it("2001자 → too_long [major], passed: false", () => {
    const r = audit_memory_entry({ content: "A".repeat(2001) });
    expect(r.passed).toBe(false);
    expect(r.violations.some((v) => v.code === "too_long")).toBe(true);
  });

  it("정확히 2000자 → 통과", () => {
    const r = audit_memory_entry({ content: "A".repeat(2000) });
    expect(r.violations.some((v) => v.code === "too_long")).toBe(false);
  });

  it("커스텀 max_chars=100 → 101자 실패", () => {
    const rule: MemoryQualityRule = { max_chars: 100, noisy_pattern_check: false };
    const r = audit_memory_entry({ content: "X".repeat(101) }, rule);
    expect(r.passed).toBe(false);
    expect(r.violations[0].code).toBe("too_long");
  });
});

// ── noisy_content ─────────────────────────────────────────────────────────────

describe("audit_memory_entry — noisy_content 위반 [minor]", () => {
  it("shell 프롬프트 포함 → noisy_content", () => {
    const r = audit_memory_entry({ content: "결과:\n$ ls -la\nfoo.txt\n" });
    expect(r.violations.some((v) => v.code === "noisy_content")).toBe(true);
    expect(r.violations.find((v) => v.code === "noisy_content")?.severity).toBe("minor");
  });

  it("stack trace 포함 → noisy_content", () => {
    const r = audit_memory_entry({ content: "Error: something failed\n  at func (file.ts:10:5)" });
    expect(r.violations.some((v) => v.code === "noisy_content")).toBe(true);
  });

  it("테스트 러너 출력 포함 → noisy_content", () => {
    const r = audit_memory_entry({ content: "PASS src/foo.test.ts\n✓ 테스트 통과" });
    expect(r.violations.some((v) => v.code === "noisy_content")).toBe(true);
  });

  it("noisy_pattern_check=false → 검사 안 함", () => {
    const rule: MemoryQualityRule = { max_chars: 2000, noisy_pattern_check: false };
    const r = audit_memory_entry({ content: "$ ls -la" }, rule);
    expect(r.violations.some((v) => v.code === "noisy_content")).toBe(false);
  });
});

// ── 정상 항목 ─────────────────────────────────────────────────────────────────

describe("audit_memory_entry — 정상 항목 통과", () => {
  it("짧은 자연어 메모 → passed: true", () => {
    const r = audit_memory_entry({ content: "사용자가 React Query를 선호한다고 밝혔다." });
    expect(r.passed).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("적절한 길이 + 코드 스니펫 (shell 프롬프트 없음) → 통과", () => {
    const r = audit_memory_entry({ content: "설정 파일 위치: /etc/config.yaml\n값: timeout=30s" });
    expect(r.passed).toBe(true);
  });

  it("hint 필드 무시 (판정에 영향 없음)", () => {
    const r = audit_memory_entry({ content: "정상 메모", hint: "shell" });
    expect(r.passed).toBe(true);
  });
});

// ── too_long + noisy 동시 ─────────────────────────────────────────────────────

describe("audit_memory_entry — 복합 위반", () => {
  it("긴 + noisy → too_long major + noisy minor, passed: false", () => {
    const content = "$ ls -la\n" + "A".repeat(2001);
    const r = audit_memory_entry({ content });
    const codes = r.violations.map((v) => v.code);
    expect(codes).toContain("too_long");
    expect(codes).toContain("noisy_content");
    expect(r.passed).toBe(false);
  });
});

// ── audit_memory_entries (일괄) ───────────────────────────────────────────────

describe("audit_memory_entries — 일괄 감사", () => {
  it("3개 항목 → 3개 결과", () => {
    const entries = [
      { content: "정상 메모" },
      { content: "" },
      { content: "A".repeat(2001) },
    ];
    const results = audit_memory_entries(entries);
    expect(results).toHaveLength(3);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[2].passed).toBe(false);
  });

  it("빈 배열 → 빈 결과", () => {
    expect(audit_memory_entries([])).toHaveLength(0);
  });
});
