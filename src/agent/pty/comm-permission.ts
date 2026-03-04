/** CommPermission — 에이전트간 통신 권한 매트릭스. 기본 정책: deny-all. */

export type CommPermissionRule = {
  from: string;
  to: string;
  allowed: boolean;
  /** 체인 깊이 제한. A→B→C 에서 depth 1이면 B→C 차단. */
  max_depth?: number;
};

export type CommPermissionCheck = {
  from: string;
  to: string;
  depth?: number;
};

/** 에이전트간 통신 권한 판정. 규칙: 구체적 > 와일드카드 > 기본 거부. */
export class CommPermissionGuard {
  private rules: CommPermissionRule[];

  constructor(rules: CommPermissionRule[] = []) {
    this.rules = rules;
  }

  is_allowed(opts: CommPermissionCheck): boolean {
    const depth = opts.depth ?? 0;
    const matched = this.find_rule(opts.from, opts.to);
    if (!matched) return false; // default deny
    if (matched.max_depth !== undefined && depth > matched.max_depth) return false;
    return matched.allowed;
  }

  update_rules(rules: CommPermissionRule[]): void {
    this.rules = rules;
  }

  private find_rule(from: string, to: string): CommPermissionRule | null {
    // 1. 정확 매칭
    const exact = this.rules.find((r) => r.from === from && r.to === to);
    if (exact) return exact;
    // 2. from 와일드카드
    const from_wild = this.rules.find((r) => r.from === "*" && r.to === to);
    if (from_wild) return from_wild;
    // 3. to 와일드카드
    const to_wild = this.rules.find((r) => r.from === from && r.to === "*");
    if (to_wild) return to_wild;
    // 4. 양쪽 와일드카드
    const both_wild = this.rules.find((r) => r.from === "*" && r.to === "*");
    return both_wild ?? null;
  }
}
