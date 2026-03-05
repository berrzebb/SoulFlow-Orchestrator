import type { PromiseService } from "../../decision/index.js";
import { PolicyTool, type PolicyStoreLike } from "./policy-tool.js";

/** PromiseService → PolicyStoreLike 어댑터. */
function adapt(svc: PromiseService): PolicyStoreLike {
  return {
    list: (f) => svc.list_promises(f),
    append: (i) => svc.append_promise(i),
    get_effective: (c) => svc.get_effective_promises(c),
  };
}

/** 오케스트레이터가 약속(Promise)을 직접 조회·설정할 수 있는 도구. */
export class PromiseTool extends PolicyTool {
  constructor(promises: PromiseService) {
    super(adapt(promises), {
      tool_name: "promise",
      description: "약속(제약 조건) 조회·설정. action=list|set|get_effective",
      default_source: "agent",
      labels: {
        item: "약속",
        empty_list: "(활성 약속 없음)",
        empty_effective: "(유효 약속 없음)",
      },
    });
  }
}
