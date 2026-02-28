/**
 * 약속(Promise) 서비스 — "다시는 이런 실수를 하지 않겠다" 유형의 제약 조건.
 * Decision과 동일한 저장소 구조를 재사용하되 별도 디렉토리(promises/)에 저장.
 */
import type {
  AppendDecisionInput,
  AppendDecisionResult,
  DecisionRecord,
  EffectiveDecisionContext,
  ListDecisionsFilter,
} from "./types.js";
import { join } from "node:path";
import { DecisionService } from "./service.js";

export class PromiseService {
  private readonly inner: DecisionService;

  constructor(root = process.cwd(), promises_dir_override?: string) {
    const dir = promises_dir_override || join(root, "runtime", "promises");
    this.inner = new DecisionService(root, dir);
  }

  async append_promise(input: AppendDecisionInput): Promise<AppendDecisionResult> {
    return this.inner.append_decision(input);
  }

  async list_promises(filter?: ListDecisionsFilter): Promise<DecisionRecord[]> {
    return this.inner.list_decisions(filter);
  }

  async get_effective_promises(context?: EffectiveDecisionContext): Promise<DecisionRecord[]> {
    return this.inner.get_effective_decisions(context);
  }

  async build_compact_injection(context?: EffectiveDecisionContext): Promise<string> {
    const rows = await this.get_effective_promises(context);
    if (rows.length === 0) return "";
    const lines = rows.map((r) => `- [P${r.priority}] ${r.canonical_key}: ${r.value}`);
    return ["# PROMISES_COMPACT", ...lines].join("\n");
  }

  async dedupe_promises(): Promise<{ removed: number; active: number }> {
    return this.inner.dedupe_decisions();
  }
}
