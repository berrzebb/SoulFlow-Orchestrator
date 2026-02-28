import type { RuntimeExecutionPolicy } from "../providers/index.js";

export interface RuntimePolicyResolver {
  resolve(task: string, media_inputs: string[]): RuntimeExecutionPolicy;
}

/** 키워드 정규식 없이 항상 full-auto. 위험 작업 제어는 ApprovalService가 담당. */
export class DefaultRuntimePolicyResolver implements RuntimePolicyResolver {
  resolve(_task: string, _media_inputs: string[]): RuntimeExecutionPolicy {
    return {
      permission_profile: "full-auto",
      command_profile: "extended",
    };
  }
}
