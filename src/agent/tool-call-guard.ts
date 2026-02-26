import type { ToolCallRequest } from "../providers/types.js";

export type ToolCallGuardDecision = {
  blocked: boolean;
  reason?: string;
};

export interface ToolCallGuard {
  observe(tool_calls: ToolCallRequest[]): ToolCallGuardDecision;
  reset(): void;
}

function signature_of(tool_calls: ToolCallRequest[]): string {
  const rows = (tool_calls || [])
    .map((row) => ({
      name: String(row.name || "").trim().toLowerCase(),
      arguments: row.arguments || {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify(rows);
}

export class ConsecutiveToolCallGuard implements ToolCallGuard {
  private readonly max_repeated_rounds: number;
  private last_signature = "";
  private repeated_rounds = 0;

  constructor(max_repeated_rounds = 2) {
    this.max_repeated_rounds = Math.max(1, Number(max_repeated_rounds || 2));
  }

  observe(tool_calls: ToolCallRequest[]): ToolCallGuardDecision {
    if (!Array.isArray(tool_calls) || tool_calls.length === 0) {
      this.reset();
      return { blocked: false };
    }
    const signature = signature_of(tool_calls);
    if (!signature) {
      this.reset();
      return { blocked: false };
    }
    if (signature === this.last_signature) {
      this.repeated_rounds += 1;
    } else {
      this.last_signature = signature;
      this.repeated_rounds = 0;
    }
    if (this.repeated_rounds >= this.max_repeated_rounds) {
      return {
        blocked: true,
        reason: "repeated_tool_calls",
      };
    }
    return { blocked: false };
  }

  reset(): void {
    this.last_signature = "";
    this.repeated_rounds = 0;
  }
}
