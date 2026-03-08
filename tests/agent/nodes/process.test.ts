/** Process 노드 핸들러 테스트
 *
 * 목표: process_handler를 통한 프로세스 관리 (list/start/stop/info) 검증
 *       - operation: list, start, stop, info 분기
 *       - filter: 프로세스 필터링
 *       - command: 새로운 프로세스 시작
 *       - pid: 프로세스 ID 지정
 *       - 템플릿 변수 해석
 *       - Windows/Unix 호환성
 *       - 에러 핸들링
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { process_handler } from "@src/agent/nodes/process.js";
import type { ProcessNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

// Mock run_shell_command
vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

import { run_shell_command } from "@src/agent/tools/shell-runtime.js";

/* ── Mock Data ── */

const createMockProcessNode = (overrides?: Partial<ProcessNodeDefinition>): ProcessNodeDefinition => ({
  node_id: "process-1",
  title: "Test Process Node",
  node_type: "process",
  operation: "list",
  command: "",
  pid: 0,
  signal: "SIGTERM",
  filter: "",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  workspace: { id: "workspace-1", api_key: "test-key" },
  abort_signal: undefined,
  ...overrides,
});

/* ── Tests ── */

describe("Process Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(process_handler.node_type).toBe("process");
    });

    it("should have output_schema with output, success, pid", () => {
      const schema = process_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("output");
      expect(fields).toContain("success");
      expect(fields).toContain("pid");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = process_handler.create_default?.();
      expect(defaultNode?.operation).toBe("list");
      expect(defaultNode?.signal).toBe("SIGTERM");
    });
  });

  describe("execute — list operation", () => {
    it("should list all processes without filter", async () => {
      const node = createMockProcessNode({
        operation: "list",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "PID  PPID  USER  %CPU  COMMAND\n1    0     root  0.0   init\n100  1     user  1.5   node",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(typeof result.output.output).toBe("string");
      expect(result.output.output).toContain("PID");
    });

    it("should list processes with filter", async () => {
      const node = createMockProcessNode({
        operation: "list",
        filter: "node",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "100  1  user  1.5  node",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalled();
      const cmd = (run_shell_command as any).mock.calls[0][0];
      expect(cmd).toContain("node");
    });

    it("should handle empty process list gracefully", async () => {
      const node = createMockProcessNode({
        operation: "list",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: undefined,
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toBe("(no processes)");
    });
  });

  describe("execute — start operation", () => {
    it("should start process with command", async () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "node app.js",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "started",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toBe("started");
    });

    it("should fail when start command is empty", async () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "",
      });
      const ctx = createMockContext();

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.error).toContain("command required");
    });

    it("should fail when start command is only whitespace", async () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "   ",
      });
      const ctx = createMockContext();

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });

    it("should resolve template variables in command", async () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "{{memory.command}}",
      });
      const ctx = createMockContext({
        memory: { command: "python script.py" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "started",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });
  });

  describe("execute — stop operation", () => {
    it("should stop process with valid pid", async () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 1234,
        signal: "SIGTERM",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.pid).toBe(1234);
      expect(result.output.output).toContain("SIGTERM");
      expect(result.output.output).toContain("1234");
    });

    it("should fail when stop pid is missing", async () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 0,
      });
      const ctx = createMockContext();

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.error).toContain("pid required");
    });

    it("should support different signals", async () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 5678,
        signal: "SIGKILL",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("SIGKILL");
    });

    it("should handle signal errors gracefully", async () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 9999,
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockRejectedValueOnce(
        new Error("Permission denied")
      );

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.output).toContain("Permission denied");
    });
  });

  describe("execute — info operation", () => {
    it("should get process info with valid pid", async () => {
      const node = createMockProcessNode({
        operation: "info",
        pid: 1234,
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "1234  1  root  0.5  node app.js",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.pid).toBe(1234);
      expect(result.output.output).toContain("node");
    });

    it("should fail when info pid is missing", async () => {
      const node = createMockProcessNode({
        operation: "info",
        pid: 0,
      });
      const ctx = createMockContext();

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.error).toContain("pid required");
    });

    it("should handle non-existent pid gracefully", async () => {
      const node = createMockProcessNode({
        operation: "info",
        pid: 99999,
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: undefined,
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("not found");
    });
  });

  describe("execute — unsupported operation", () => {
    it("should return error for unknown operation", async () => {
      const node = createMockProcessNode({
        operation: "unknown_op",
      });
      const ctx = createMockContext();

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.error).toContain("unsupported operation");
    });

    it("should handle operation template resolution", async () => {
      const node = createMockProcessNode({
        operation: "{{memory.op}}",
      });
      const ctx = createMockContext({
        memory: { op: "unknown" },
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });
  });

  describe("execute — template variable resolution", () => {
    it("should resolve filter template", async () => {
      const node = createMockProcessNode({
        operation: "list",
        filter: "{{memory.process_name}}",
      });
      const ctx = createMockContext({
        memory: { process_name: "python" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "some output",
      });

      await process_handler.execute(node, ctx);

      const cmd = (run_shell_command as any).mock.calls[0][0];
      expect(cmd).toContain("python");
    });

    it("should handle missing template variables as empty", async () => {
      const node = createMockProcessNode({
        operation: "list",
        filter: "{{memory.missing}}",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "output",
      });

      await process_handler.execute(node, ctx);

      const cmd = (run_shell_command as any).mock.calls[0][0];
      // Empty filter should be treated as no filter
      expect(typeof cmd).toBe("string");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid list operation", () => {
      const node = createMockProcessNode({
        operation: "list",
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when operation is missing", () => {
      const node = createMockProcessNode({
        operation: "",
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.warnings).toContain("operation is required");
    });

    it("should warn when start operation lacks command", () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "",
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.warnings).toContain("command required for start");
    });

    it("should warn when stop operation lacks pid", () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 0,
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.warnings).toContain("pid required");
    });

    it("should warn when info operation lacks pid", () => {
      const node = createMockProcessNode({
        operation: "info",
        pid: 0,
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.warnings).toContain("pid required");
    });

    it("should include preview with operation details", () => {
      const node = createMockProcessNode({
        operation: "list",
        command: "test_cmd",
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.preview.operation).toBe("list");
      expect(result.preview.command).toBe("test_cmd");
    });

    it("should include pid in preview", () => {
      const node = createMockProcessNode({
        operation: "info",
        pid: 1234,
      });
      const ctx = createMockContext();

      const result = process_handler.test(node, ctx);

      expect(result.preview.pid).toBe(1234);
    });
  });

  describe("integration scenarios", () => {
    it("should list and filter processes", async () => {
      const node = createMockProcessNode({
        operation: "list",
        filter: "java",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "12345  root  java -jar app.jar",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("java");
    });

    it("should start background process", async () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "npm start",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "started",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });

    it("should gracefully terminate process", async () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 5555,
        signal: "SIGTERM",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("SIGTERM");
      expect(result.output.output).toContain("5555");
    });

    it("should forcefully kill unresponsive process", async () => {
      const node = createMockProcessNode({
        operation: "stop",
        pid: 6666,
        signal: "SIGKILL",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("SIGKILL");
    });

    it("should monitor process resource usage", async () => {
      const node = createMockProcessNode({
        operation: "info",
        pid: 7777,
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "7777  1  user  25.5  64.2  node app.js",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.pid).toBe(7777);
    });

    it("should handle workflow process control with templates", async () => {
      const node = createMockProcessNode({
        operation: "start",
        command: "{{memory.cmd}}",
      });
      const ctx = createMockContext({
        memory: { cmd: "docker run myimage" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "started",
      });

      const result = await process_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });
  });
});
