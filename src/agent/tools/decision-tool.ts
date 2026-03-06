import type { DecisionService } from "../../decision/index.js";
import { PolicyTool, type PolicyStoreLike } from "./policy-tool.js";

/** DecisionService → PolicyStoreLike 어댑터. */
function adapt(svc: DecisionService): PolicyStoreLike {
  return {
    list: (f) => svc.list_decisions(f),
    append: (i) => svc.append_decision(i),
    get_effective: (c) => svc.get_effective_decisions(c),
  };
}

/** 오케스트레이터가 결정사항을 직접 조회·설정할 수 있는 도구. */
export class DecisionTool extends PolicyTool {
  constructor(decisions: DecisionService) {
    super(adapt(decisions), {
      tool_name: "decision",
      category: "decision",
      description: "결정사항 조회·설정. action=list|set|get_effective",
      default_source: "system",
      labels: {
        item: "결정",
        empty_list: "(활성 결정사항 없음)",
        empty_effective: "(유효 결정사항 없음)",
      },
    });
  }
}
