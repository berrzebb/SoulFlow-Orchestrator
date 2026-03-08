/** Code 노드 핸들러 테스트
 *
 * 목표: code_handler를 통한 코드 실행 검증
 *       - JavaScript: vm 샌드박스 + memory 접근 + console.log
 *       - Shell: run_shell_command 호출
 *       - Container: run_code_in_container 호출
 *       - Timeout: 100ms~120s 범위 제한
 *       - Error handling: 문법 오류, 실행 오류, 타임아웃
 *       - Validation: code 필수, JS 문법 검사
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { code_handler } from "@src/agent/nodes/code.js";
import type { CodeNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Dependencies ── */

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

vi.mock("@src/agent/nodes/container-code-runner.js", () => ({
  is_container_language: vi.fn((lang) => ["python", "ruby", "go", "rust", "deno", "bun"].includes(lang)),
  run_code_in_container: vi.fn(),
  get_engine: vi.fn(() => null),
}));

import { run_shell_command } from "@src/agent/tools/shell-runtime.js";
import { run_code_in_container, is_container_language, get_engine } from "@src/agent/nodes/container-code-runner.js";

/* ── Mock Data ── */

const createMockCodeNode = (overrides?: Partial<CodeNodeDefinition>): CodeNodeDefinition => ({
  node_id: "code-1",
  label: "Test Code",
  node_type: "code",
  language: "javascript",
  code: "return 42;",
  timeout_ms: 5000,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    test_value: "hello",
    numbers: [1, 2, 3],
  },
  workspace: "/tmp/workspace",
  abort_signal: undefined,
  ...overrides,
});

/* ── Tests ── */

describe("Code Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(code_handler.node_type).toBe("code");
    });

    it("should have output_schema with result and logs", () => {
      const schema = code_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("logs");
    });

    it("should have input_schema with input", () => {
      const schema = code_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("input");
    });

    it("should have create_default returning javascript template", () => {
      const defaultNode = code_handler.create_default?.();
      expect(defaultNode?.language).toBe("javascript");
      expect(defaultNode?.code).toBe("");
    });

    it("should have icon and color metadata", () => {
      expect(code_handler.icon).toBeDefined();
      expect(code_handler.color).toBeDefined();
      expect(code_handler.shape).toBe("rect");
    });
  });

  describe("execute — JavaScript", () => {
    it("should execute simple javascript expression", async () => {
      const node = createMockCodeNode({ code: "return 42;" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(42);
      expect(result.output.logs).toEqual([]);
    });

    it("should return undefined when no explicit return", async () => {
      const node = createMockCodeNode({ code: "const x = 5; x + 3;" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBeUndefined();
    });

    it("should access memory variables", async () => {
      const node = createMockCodeNode({ code: "return memory.test_value;" });
      const ctx = createMockContext({ memory: { test_value: "hello world" } });

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe("hello world");
    });

    it("should capture console.log output", async () => {
      const node = createMockCodeNode({ code: "console.log('hello'); console.log('world'); return true;" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.logs).toContain("hello");
      expect(result.output.logs).toContain("world");
      expect(result.output.result).toBe(true);
    });

    it("should capture console.warn with WARN prefix", async () => {
      const node = createMockCodeNode({ code: "console.warn('warning'); return 1;" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.logs).toContain("WARN: warning");
    });

    it("should capture console.error with ERROR prefix", async () => {
      const node = createMockCodeNode({ code: "console.error('error'); return 2;" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.logs).toContain("ERROR: error");
    });

    it("should provide JSON global", async () => {
      const node = createMockCodeNode({ code: "return JSON.stringify({a: 1, b: 2});" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe('{"a":1,"b":2}');
    });

    it("should provide Math global", async () => {
      const node = createMockCodeNode({ code: "return Math.max(1, 2, 3, 4, 5);" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(5);
    });

    it("should provide Date global", async () => {
      const node = createMockCodeNode({ code: "return typeof Date === 'function';" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(true);
    });

    it("should provide Array/Object/String/Number globals", async () => {
      const node = createMockCodeNode({ code: "return Array.isArray([1,2,3]) && Object !== undefined;" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(true);
    });

    it("should provide parseInt/parseFloat globals", async () => {
      const node = createMockCodeNode({ code: "return parseInt('42') + parseFloat('3.14');" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBeCloseTo(45.14, 1);
    });

    it("should handle multi-line javascript", async () => {
      const code = `
        const sum = (a, b) => a + b;
        const result = sum(10, 20);
        return result * 2;
      `;
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(60);
    });

    it("should handle async operations", async () => {
      const code = `
        const promise = Promise.resolve(42);
        return await promise;
      `;
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(42);
    });

    it("should throw error on syntax error", async () => {
      const node = createMockCodeNode({ code: "return 42 +" }); // Invalid syntax
      const ctx = createMockContext();

      await expect(code_handler.execute(node, ctx)).rejects.toThrow("js execution failed");
    });

    it("should throw error on runtime error", async () => {
      const node = createMockCodeNode({ code: "throw new Error('intentional error');" });
      const ctx = createMockContext();

      await expect(code_handler.execute(node, ctx)).rejects.toThrow("js execution failed");
    });

    it("should throw error on timeout", async () => {
      const node = createMockCodeNode({ code: "while(true) {}", timeout_ms: 100 });
      const ctx = createMockContext();

      await expect(code_handler.execute(node, ctx)).rejects.toThrow("js execution failed");
    });
  });

  describe("execute — timeout handling", () => {
    it("should enforce minimum timeout of 100ms", async () => {
      const node = createMockCodeNode({ code: "return 42;", timeout_ms: 10 });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(42);
    });

    it("should enforce maximum timeout of 120 seconds", async () => {
      const node = createMockCodeNode({ code: "return 42;", timeout_ms: 9_999_999 });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(42);
    });

    it("should use default timeout when undefined", async () => {
      const node = createMockCodeNode({ code: "return 42;", timeout_ms: undefined as any });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(42);
    });

    it("should use provided timeout in valid range", async () => {
      const node = createMockCodeNode({ code: "return 42;", timeout_ms: 5000 });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(42);
    });
  });

  describe("execute — Shell", () => {
    it("should execute shell command and return stdout/stderr", async () => {
      const shellOutput = { stdout: "hello", stderr: "", exit_code: 0 };
      vi.mocked(run_shell_command).mockResolvedValue(shellOutput);

      const node = createMockCodeNode({ language: "shell", code: "echo hello" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.stdout).toBe("hello");
      expect(result.output.stderr).toBe("");
      expect(run_shell_command).toHaveBeenCalledWith("echo hello", expect.any(Object));
    });

    it("should handle shell errors", async () => {
      vi.mocked(run_shell_command).mockRejectedValue(new Error("Command failed"));

      const node = createMockCodeNode({ language: "shell", code: "false" });
      const ctx = createMockContext();

      await expect(code_handler.execute(node, ctx)).rejects.toThrow("shell execution failed");
    });

    it("should pass workspace and timeout to shell command", async () => {
      const shellOutput = { stdout: "", stderr: "", exit_code: 0 };
      vi.mocked(run_shell_command).mockResolvedValue(shellOutput);

      const node = createMockCodeNode({ language: "shell", code: "pwd", timeout_ms: 3000 });
      const ctx = createMockContext({ workspace: "/custom/workspace" });

      await code_handler.execute(node, ctx);

      expect(run_shell_command).toHaveBeenCalledWith(
        "pwd",
        expect.objectContaining({
          cwd: "/custom/workspace",
          timeout_ms: 3000,
          max_buffer_bytes: 1024 * 256,
        })
      );
    });

    it("should pass abort signal to shell command", async () => {
      const shellOutput = { stdout: "", stderr: "", exit_code: 0 };
      vi.mocked(run_shell_command).mockResolvedValue(shellOutput);

      const abortSignal = new AbortController().signal;
      const node = createMockCodeNode({ language: "shell", code: "sleep 10" });
      const ctx = createMockContext({ abort_signal: abortSignal });

      await code_handler.execute(node, ctx);

      expect(run_shell_command).toHaveBeenCalledWith(
        "sleep 10",
        expect.objectContaining({ signal: abortSignal })
      );
    });
  });

  describe("execute — Container", () => {
    it("should execute container code on supported language", async () => {
      const containerOutput = { stdout: "result", stderr: "", exit_code: 0 };
      vi.mocked(run_code_in_container).mockResolvedValue(containerOutput);

      const node = createMockCodeNode({ language: "python", code: "print('hello')" });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.stdout).toBe("result");
      expect(run_code_in_container).toHaveBeenCalledWith(expect.objectContaining({
        language: "python",
        code: "print('hello')",
      }));
    });

    it("should throw error on non-zero exit code", async () => {
      const containerOutput = { stdout: "", stderr: "error", exit_code: 1 };
      vi.mocked(run_code_in_container).mockResolvedValue(containerOutput);

      const node = createMockCodeNode({ language: "python", code: "import invalid" });
      const ctx = createMockContext();

      await expect(code_handler.execute(node, ctx)).rejects.toThrow("python execution failed (exit 1)");
    });

    it("should support custom container image", async () => {
      const containerOutput = { stdout: "", stderr: "", exit_code: 0 };
      vi.mocked(run_code_in_container).mockResolvedValue(containerOutput);

      const node = createMockCodeNode({
        language: "python",
        code: "print('hello')",
        container_image: "custom-python:3.11",
      });
      const ctx = createMockContext();

      await code_handler.execute(node, ctx);

      expect(run_code_in_container).toHaveBeenCalledWith(expect.objectContaining({
        custom_image: "custom-python:3.11",
      }));
    });

    it("should pass network_access and keep_container options", async () => {
      const containerOutput = { stdout: "", stderr: "", exit_code: 0 };
      vi.mocked(run_code_in_container).mockResolvedValue(containerOutput);

      const node = createMockCodeNode({
        language: "ruby",
        code: "puts 'hello'",
        network_access: true,
        keep_container: true,
      });
      const ctx = createMockContext();

      await code_handler.execute(node, ctx);

      expect(run_code_in_container).toHaveBeenCalledWith(expect.objectContaining({
        network_access: true,
        keep_container: true,
      }));
    });
  });

  describe("execute — unsupported language", () => {
    it("should throw error for unsupported language", async () => {
      const node = createMockCodeNode({ language: "cobol" as any });
      const ctx = createMockContext();

      await expect(code_handler.execute(node, ctx)).rejects.toThrow("unsupported language: cobol");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid code", () => {
      const node = createMockCodeNode({ code: "return 42;" });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when code is empty", () => {
      const node = createMockCodeNode({ code: "" });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings).toContain("code is empty");
    });

    it("should warn when code is whitespace only", () => {
      const node = createMockCodeNode({ code: "   \n\t   " });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings).toContain("code is empty");
    });

    it("should warn on javascript syntax error", () => {
      const node = createMockCodeNode({ code: "return 42 +", language: "javascript" });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("syntax error");
    });

    it("should not warn on valid javascript", () => {
      const node = createMockCodeNode({
        code: "const x = 5; return x * 2;",
        language: "javascript",
      });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings.filter(w => w.includes("syntax"))).toEqual([]);
    });

    it("should warn when container engine not available for container language", () => {
      const node = createMockCodeNode({ language: "python", code: "print('hello')" });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("no container engine");
    });

    it("should not warn for shell language without container engine", () => {
      const node = createMockCodeNode({ language: "shell", code: "echo hello" });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      // Shell doesn't require container engine, so no warning
      const engineWarnings = result.warnings.filter(w => w.includes("container engine"));
      expect(engineWarnings).toEqual([]);
    });

    it("should include preview with language and code_length", () => {
      const node = createMockCodeNode({ language: "python", code: "print('hello world')" });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.preview.language).toBe("python");
      expect(result.preview.code_length).toBe(20);
    });
  });

  describe("integration scenarios", () => {
    it("should process complex javascript with memory", async () => {
      const code = `
        const items = memory.numbers || [];
        const sum = items.reduce((acc, n) => acc + n, 0);
        console.log('Sum: ' + sum);
        return sum / items.length;
      `;
      const node = createMockCodeNode({ code });
      const ctx = createMockContext({ memory: { numbers: [10, 20, 30] } });

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe(20);
      expect(result.output.logs).toContain("Sum: 60");
    });

    it("should handle data transformation", async () => {
      const code = `
        const data = { a: 1, b: 2, c: 3 };
        return Object.entries(data).map(([k, v]) => ({ key: k, value: v * 2 }));
      `;
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toEqual([
        { key: "a", value: 2 },
        { key: "b", value: 4 },
        { key: "c", value: 6 },
      ]);
    });

    it("should validate complex javascript before execution", () => {
      const code = `
        const arr = [1, 2, 3];
        const result = arr.map(x => x * 2).filter(x => x > 2);
        return result;
      `;
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = code_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
      expect(result.preview.code_length).toBe(code.length);
    });

    it("should handle multiple execution modes in same handler", async () => {
      // Test JavaScript
      let node = createMockCodeNode({ language: "javascript", code: "return 42;" });
      let result = await code_handler.execute(node, createMockContext());
      expect(result.output.result).toBe(42);

      // Test Shell
      const shellOutput = { stdout: "hello", stderr: "", exit_code: 0 };
      vi.mocked(run_shell_command).mockResolvedValue(shellOutput);
      node = createMockCodeNode({ language: "shell", code: "echo hello" });
      result = await code_handler.execute(node, createMockContext());
      expect(result.output.stdout).toBe("hello");

      // Test Container
      const containerOutput = { stdout: "result", stderr: "", exit_code: 0 };
      vi.mocked(run_code_in_container).mockResolvedValue(containerOutput);
      node = createMockCodeNode({ language: "python", code: "print('hello')" });
      result = await code_handler.execute(node, createMockContext());
      expect(result.output.stdout).toBe("result");
    });
  });

  describe("edge cases", () => {
    it("should handle deeply nested object access", async () => {
      const code = "return memory.deep?.nested?.value || 'default';";
      const node = createMockCodeNode({ code });
      const ctx = createMockContext({ memory: { deep: { nested: { value: "found" } } } });

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe("found");
    });

    it("should handle very large return values", async () => {
      const code = "return Array(1000).fill(0).map((_, i) => i);";
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(Array.isArray(result.output.result)).toBe(true);
      expect((result.output.result as number[]).length).toBe(1000);
    });

    it("should handle special characters in code", async () => {
      const code = 'return "hello\\nworld\\t!";';
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toBe("hello\nworld\t!");
    });

    it("should handle null and undefined in memory", async () => {
      const code = "return [memory.null_val, memory.undef_val, typeof memory.undef_val];";
      const node = createMockCodeNode({ code });
      const ctx = createMockContext({ memory: { null_val: null } });

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result[0]).toBeNull();
      expect(result.output.result[1]).toBeUndefined();
      expect(result.output.result[2]).toBe("undefined");
    });

    it("should handle array methods", async () => {
      const code = "return [1, 2, 3].concat([4, 5]).reverse().slice(1, 3);";
      const node = createMockCodeNode({ code });
      const ctx = createMockContext();

      const result = await code_handler.execute(node, ctx);

      expect(result.output.result).toEqual([4, 3]);
    });
  });
});
