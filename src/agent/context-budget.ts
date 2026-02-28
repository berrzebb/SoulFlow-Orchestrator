/** 컨텍스트 윈도우 토큰 예산 관리 — 우선순위 기반 섹션 선택. */

export type BudgetSection = {
  name: string;
  content: string;
  priority: number;  // 0(필수) ~ 3(선택적)
  estimated_tokens: number;
};

export type ContextBudgetOptions = {
  max_tokens: number;
};

export class ContextBudget {
  private readonly max_tokens: number;
  private _total_tokens = 0;

  constructor(opts: ContextBudgetOptions) {
    this.max_tokens = opts.max_tokens;
  }

  /** 텍스트 길이 기반 토큰 추정. 4 chars ≈ 1 token (영어/한국어 혼합 휴리스틱). */
  static estimate_tokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /** 예산 내에서 우선순위 순으로 섹션 선택. priority 0은 항상 포함. */
  fit(sections: BudgetSection[]): BudgetSection[] {
    const sorted = [...sections].sort((a, b) => a.priority - b.priority);
    const selected: BudgetSection[] = [];
    let budget_remaining = this.max_tokens;

    for (const section of sorted) {
      if (section.priority === 0) {
        selected.push(section);
        budget_remaining -= section.estimated_tokens;
        continue;
      }
      if (budget_remaining > 0 && section.estimated_tokens <= budget_remaining) {
        selected.push(section);
        budget_remaining -= section.estimated_tokens;
      }
    }

    this._total_tokens = this.max_tokens - budget_remaining;
    return selected;
  }

  get total_tokens(): number {
    return this._total_tokens;
  }
}
