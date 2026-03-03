import { describe, it, expect } from "vitest";
import { ContextBudget, type BudgetSection } from "@src/agent/context-budget.ts";

function section(name: string, priority: number, chars: number): BudgetSection {
  const content = "x".repeat(chars);
  return { name, content, priority, estimated_tokens: ContextBudget.estimate_tokens(content) };
}

describe("ContextBudget", () => {
  it("estimate_tokens — 4 chars ≈ 1 token", () => {
    expect(ContextBudget.estimate_tokens("")).toBe(0);
    expect(ContextBudget.estimate_tokens("abcd")).toBe(1);
    expect(ContextBudget.estimate_tokens("abcde")).toBe(2);
    expect(ContextBudget.estimate_tokens("a".repeat(100))).toBe(25);
  });

  it("예산 충분 → 모든 섹션 포함", () => {
    const budget = new ContextBudget({ max_tokens: 10000 });
    const sections = [
      section("identity", 0, 100),
      section("memory", 1, 200),
      section("skills", 2, 300),
    ];

    const result = budget.fit(sections);
    expect(result).toHaveLength(3);
  });

  it("예산 초과 → 낮은 우선순위 섹션 제거", () => {
    const budget = new ContextBudget({ max_tokens: 50 });
    const sections = [
      section("identity", 0, 100),   // 25 tokens — 필수
      section("memory", 1, 40),      // 10 tokens
      section("skills", 2, 200),     // 50 tokens — 초과, 제거됨
      section("decisions", 3, 80),   // 20 tokens — 초과, 제거됨
    ];

    const result = budget.fit(sections);
    const names = result.map((s) => s.name);
    expect(names).toContain("identity");
    expect(names).toContain("memory");
    expect(names).not.toContain("skills");
  });

  it("priority 0은 예산 초과해도 항상 포함", () => {
    const budget = new ContextBudget({ max_tokens: 10 });
    const sections = [
      section("critical", 0, 200),  // 50 tokens > max_tokens
    ];

    const result = budget.fit(sections);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("critical");
  });

  it("같은 우선순위 내에서 먼저 오는 섹션 우선", () => {
    const budget = new ContextBudget({ max_tokens: 30 });
    const sections = [
      section("a", 1, 80),   // 20 tokens
      section("b", 1, 80),   // 20 tokens — 예산 부족으로 제외
    ];

    const result = budget.fit(sections);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a");
  });

  it("total_tokens 추적", () => {
    const budget = new ContextBudget({ max_tokens: 100 });
    budget.fit([
      section("a", 0, 40),   // 10 tokens
      section("b", 1, 80),   // 20 tokens
    ]);

    expect(budget.total_tokens).toBe(30);
  });

  it("빈 섹션 → 빈 결과", () => {
    const budget = new ContextBudget({ max_tokens: 100 });
    const result = budget.fit([]);
    expect(result).toHaveLength(0);
    expect(budget.total_tokens).toBe(0);
  });
});
