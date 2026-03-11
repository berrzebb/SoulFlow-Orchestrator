/**
 * validator_handler — 미커버 분기 (cov2):
 * - L37: operation="email", email_action ≠ "validate" → 결과 직접 노출 분기
 */
import { describe, it, expect } from "vitest";
import { validator_handler } from "@src/agent/nodes/validator.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

function make_ctx(): OrcheNodeExecutorContext {
  return { memory: {} };
}

// ── L37: email operation with non-validate action ──────────────────────────

describe("validator_handler — L37: email non-validate action", () => {
  it("operation=email, email_action=parse → 직접 결과 노출 분기 (L37)", async () => {
    const node = {
      node_id: "n1",
      node_type: "validator",
      operation: "email",
      email_action: "parse",
      input: "user@example.com",
    } as any;
    const result = await validator_handler.execute(node, make_ctx());
    // L37: email_action !== "validate" → valid/error_count/errors 직접 노출
    expect(result.output).toBeDefined();
    expect("valid" in result.output).toBe(true);
    expect("error_count" in result.output).toBe(true);
  });

  it("operation=email, email_action=normalize → L37 분기", async () => {
    const node = {
      node_id: "n2",
      node_type: "validator",
      operation: "email",
      email_action: "normalize",
      input: "User@EXAMPLE.COM",
    } as any;
    const result = await validator_handler.execute(node, make_ctx());
    expect(result.output).toBeDefined();
    expect("valid" in result.output).toBe(true);
  });
});
