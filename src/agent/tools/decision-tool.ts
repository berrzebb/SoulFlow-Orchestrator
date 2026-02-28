import type { DecisionService } from "../../decision/index.js";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

/** 오케스트레이터가 결정사항을 직접 조회·설정할 수 있는 도구. */
export class DecisionTool extends Tool {
  readonly name = "decision";
  readonly description = "결정사항 조회·설정. action=list|set|get_effective";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["list", "set", "get_effective"] },
      key: { type: "string", description: "결정 키 (set/list 필터)" },
      value: { type: "string", description: "결정 값 (set 시 필수)" },
      scope: { type: "string", enum: ["global", "team", "agent"], description: "스코프 (기본 global)" },
      rationale: { type: "string", description: "결정 이유 (선택)" },
      search: { type: "string", description: "list 검색어" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "list 최대 수 (기본 20)" },
    },
  };

  private readonly decisions: DecisionService;

  constructor(decisions: DecisionService) {
    super();
    this.decisions = decisions;
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "").trim();

    if (action === "list") {
      const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
      const rows = await this.decisions.list_decisions({
        status: "active",
        key: params.key ? String(params.key) : undefined,
        search: params.search ? String(params.search) : undefined,
        limit,
      });
      if (rows.length === 0) return "(활성 결정사항 없음)";
      return rows.map((r) => `[P${r.priority}] ${r.canonical_key}: ${r.value}`).join("\n");
    }

    if (action === "set") {
      const key = String(params.key || "").trim();
      const value = String(params.value || "").trim();
      if (!key || !value) return "Error: key and value are required for set";
      const scope = (String(params.scope || "global").trim()) as "global" | "team" | "agent";
      const result = await this.decisions.append_decision({
        scope,
        key,
        value,
        rationale: params.rationale ? String(params.rationale) : undefined,
        source: "system",
      });
      return `결정 ${result.action}: [${scope}] ${key} = ${result.record.value}`;
    }

    if (action === "get_effective") {
      const rows = await this.decisions.get_effective_decisions();
      if (rows.length === 0) return "(유효 결정사항 없음)";
      return rows.map((r) => `[P${r.priority}:${r.scope}] ${r.canonical_key}: ${r.value}`).join("\n");
    }

    return `Error: unknown action "${action}"`;
  }
}
