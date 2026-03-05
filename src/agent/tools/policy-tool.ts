/**
 * DecisionTool · PromiseTool 공통 기반.
 * 동일한 list/set/get_effective 패턴을 공유하므로 설정만 바꿔 인스턴스화.
 */
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import type {
  AppendDecisionInput,
  AppendDecisionResult,
  DecisionRecord,
  DecisionSource,
  EffectiveDecisionContext,
  ListDecisionsFilter,
} from "../../decision/types.js";

/** DecisionService · PromiseService 공통 계약. */
export interface PolicyStoreLike {
  list(filter?: ListDecisionsFilter): Promise<DecisionRecord[]>;
  append(input: AppendDecisionInput): Promise<AppendDecisionResult>;
  get_effective(context?: EffectiveDecisionContext): Promise<DecisionRecord[]>;
}

type PolicyToolConfig = {
  tool_name: string;
  description: string;
  default_source: DecisionSource;
  labels: {
    item: string;        // "결정" | "약속"
    empty_list: string;  // "(활성 결정사항 없음)"
    empty_effective: string; // "(유효 결정사항 없음)"
  };
};

export class PolicyTool extends Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["list", "set", "get_effective"] },
      key: { type: "string", description: "키 (set/list 필터)" },
      value: { type: "string", description: "값 (set 시 필수)" },
      scope: { type: "string", enum: ["global", "team", "agent"], description: "스코프 (기본 global)" },
      rationale: { type: "string", description: "이유 (선택)" },
      search: { type: "string", description: "list 검색어" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "list 최대 수 (기본 20)" },
    },
  };

  private readonly store: PolicyStoreLike;
  private readonly config: PolicyToolConfig;

  constructor(store: PolicyStoreLike, config: PolicyToolConfig) {
    super();
    this.name = config.tool_name;
    this.description = config.description;
    this.store = store;
    this.config = config;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "").trim();
    const { labels } = this.config;

    if (action === "list") {
      const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
      const rows = await this.store.list({
        status: "active",
        key: params.key ? String(params.key) : undefined,
        search: params.search ? String(params.search) : undefined,
        limit,
      });
      if (rows.length === 0) return labels.empty_list;
      return rows.map((r) => `[P${r.priority}] ${r.canonical_key}: ${r.value}`).join("\n");
    }

    if (action === "set") {
      const key = String(params.key || "").trim();
      const value = String(params.value || "").trim();
      if (!key || !value) return "Error: key and value are required for set";
      const scope = (String(params.scope || "global").trim()) as "global" | "team" | "agent";
      const result = await this.store.append({
        scope,
        key,
        value,
        rationale: params.rationale ? String(params.rationale) : undefined,
        source: this.config.default_source,
      });
      return `${labels.item} ${result.action}: [${scope}] ${key} = ${result.record.value}`;
    }

    if (action === "get_effective") {
      const rows = await this.store.get_effective();
      if (rows.length === 0) return labels.empty_effective;
      return rows.map((r) => `[P${r.priority}:${r.scope}] ${r.canonical_key}: ${r.value}`).join("\n");
    }

    return `Error: unknown action "${action}"`;
  }
}
