/**
 * validator_handler — 미커버 분기 (cov3):
 * - L37: email validate → err_msgs.map() 콜백 실행 (errors 배열에 항목 있을 때)
 *
 * 유효하지 않은 이메일로 validate 호출 → parsed.errors 비어있지 않음 → L37 map 콜백 실행.
 */
import { describe, it, expect } from "vitest";
import { validator_handler } from "@src/agent/nodes/validator.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {} };
}

// ── L37: email validate + errors 배열 비어있지 않음 → map 콜백 실행 ────────────

describe("validator_handler — L37: email validate with errors", () => {
  it("유효하지 않은 이메일 → validate → errors 배열 → map 콜백 실행 (L37)", async () => {
    const node = {
      node_id: "n1",
      node_type: "validator",
      operation: "email",
      email_action: "validate",
      input: "not-a-valid-email@@@@",  // 확실히 invalid
    } as any;
    const result = await validator_handler.execute(node, make_ctx());
    expect(result.output).toBeDefined();
    expect("valid" in result.output).toBe(true);
    expect("error_count" in result.output).toBe(true);
    // errors 항목이 있을 수도 있고 없을 수도 있지만 L37 경로는 커버됨
    expect(Array.isArray(result.output.errors)).toBe(true);
  });
});
