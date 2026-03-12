/**
 * system_info_handler — 미커버 분기 (L30, L48).
 * create_default + stdout 결과 경로.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_shell } = vi.hoisted(() => ({ mock_shell: vi.fn() }));

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: mock_shell,
}));

import { system_info_handler } from "@src/agent/nodes/system-info.js";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";

function make_ctx() {
  return { memory: {}, workspace: "/tmp", abort_signal: undefined } as any;
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// L30: create_default
// ══════════════════════════════════════════

describe("system_info_handler — create_default (L30)", () => {
  it("create_default → { category: 'all' }", () => {
    const d = system_info_handler.create_default!() as any;
    expect(d.category).toBe("all");
  });
});

// ══════════════════════════════════════════
// L48: stdout 결과 → info[key] = stdout.trim()
// ══════════════════════════════════════════

describe("system_info_handler — stdout 결과 경로 (L48)", () => {
  it("단일 카테고리 + stdout 반환 → info에 포함", async () => {
    mock_shell.mockResolvedValue({ stdout: "Linux\n", stderr: "" });
    const node = { node_id: "n1", node_type: "system_info", category: "os" } as OrcheNodeDefinition;
    const r = await system_info_handler.execute(node, make_ctx());
    expect(r.output.success).toBe(true);
    expect((r.output.info as any).os).toBe("Linux");
  });

  it("stdout 빈 문자열 → trim 후 빈 문자열", async () => {
    mock_shell.mockResolvedValue({ stdout: "  ", stderr: "" });
    const node = { node_id: "n1", node_type: "system_info", category: "uptime" } as OrcheNodeDefinition;
    const r = await system_info_handler.execute(node, make_ctx());
    expect(r.output.success).toBe(true);
    expect((r.output.info as any).uptime).toBe(""); // "  ".trim() = ""
  });
});
