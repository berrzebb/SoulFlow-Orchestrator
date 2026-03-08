/** Docker 노드 핸들러 테스트
 *
 * 목표: docker_handler를 통한 Docker 커맨드 실행 검증
 *       - operations: ps, images, run, stop, rm, logs, exec, inspect
 *       - safety policy: 위험한 플래그 차단 (--privileged, -v /: 등)
 *       - template variable resolution: {{memory.*}} 경로 접근
 *       - error handling: 실패 케이스 처리
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { docker_handler } from "@src/agent/nodes/docker.js";
import type { DockerNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

// Mock shell-runtime
vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

import { run_shell_command } from "@src/agent/tools/shell-runtime.js";

/* ── Mock Data ── */

const createMockDockerNode = (overrides?: Partial<DockerNodeDefinition>): DockerNodeDefinition => ({
  node_id: "docker-1",
  title: "Test Docker Node",
  node_type: "docker",
  operation: "ps",
  container: "",
  image: "",
  command: "",
  args: "",
  tail: 50,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Docker Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(docker_handler.node_type).toBe("docker");
    });

    it("should have output_schema with output and success", () => {
      const schema = docker_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("output");
      expect(fields).toContain("success");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = docker_handler.create_default?.();
      expect(defaultNode?.operation).toBe("ps");
      expect(defaultNode?.tail).toBe(50);
    });
  });

  describe("execute — ps operation", () => {
    it("should list all containers", async () => {
      const node = createMockDockerNode({
        operation: "ps",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "CONTAINER ID   IMAGE   NAMES\n123abc        alpine  myapp",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("CONTAINER ID");
      expect(run_shell_command).toHaveBeenCalledWith("docker ps -a", expect.any(Object));
    });

    it("should support custom args for ps", async () => {
      const node = createMockDockerNode({
        operation: "ps",
        args: "--no-trunc",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "container list",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker ps -a --no-trunc", expect.any(Object));
    });
  });

  describe("execute — images operation", () => {
    it("should list all images", async () => {
      const node = createMockDockerNode({
        operation: "images",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "REPOSITORY   TAG       IMAGE ID\nalpine       latest    a24bb4045c99",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("REPOSITORY");
    });

    it("should support custom args for images", async () => {
      const node = createMockDockerNode({
        operation: "images",
        args: "-q",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "a24bb4045c99\nf654123def45",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker images -q", expect.any(Object));
    });
  });

  describe("execute — run operation", () => {
    it("should run container from image", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "alpine",
        command: "echo hello",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "hello",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("hello");
      expect(run_shell_command).toHaveBeenCalledWith("docker run  alpine echo hello", expect.any(Object));
    });

    it("should support run with args", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "alpine",
        command: "pwd",
        args: "-it",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "/",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker run -it alpine pwd", expect.any(Object));
    });

    it("should fail run without image", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "",
        command: "echo test",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("unsupported");
    });
  });

  describe("execute — stop operation", () => {
    it("should stop running container", async () => {
      const node = createMockDockerNode({
        operation: "stop",
        container: "myapp",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "myapp",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker stop myapp", expect.any(Object));
    });

    it("should fail stop without container", async () => {
      const node = createMockDockerNode({
        operation: "stop",
        container: "",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });
  });

  describe("execute — rm operation", () => {
    it("should remove container", async () => {
      const node = createMockDockerNode({
        operation: "rm",
        container: "myapp",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "myapp",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker rm myapp", expect.any(Object));
    });

    it("should fail rm without container", async () => {
      const node = createMockDockerNode({
        operation: "rm",
        container: "",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });
  });

  describe("execute — logs operation", () => {
    it("should fetch container logs", async () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "myapp",
        tail: 100,
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "log line 1\nlog line 2\nlog line 3",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("log line");
      expect(run_shell_command).toHaveBeenCalledWith("docker logs --tail 100 myapp", expect.any(Object));
    });

    it("should use default tail value", async () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "myapp",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "logs",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker logs --tail 50 myapp", expect.any(Object));
    });

    it("should fail logs without container", async () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });
  });

  describe("execute — exec operation", () => {
    it("should execute command in container", async () => {
      const node = createMockDockerNode({
        operation: "exec",
        container: "myapp",
        command: "ls -la",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "total 24\ndrwxr-xr-x 2 root root 4096",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("total");
      expect(run_shell_command).toHaveBeenCalledWith("docker exec  myapp ls -la", expect.any(Object));
    });

    it("should support exec with args", async () => {
      const node = createMockDockerNode({
        operation: "exec",
        container: "myapp",
        command: "bash",
        args: "-it",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "bash shell",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith("docker exec -it myapp bash", expect.any(Object));
    });

    it("should fail exec without container", async () => {
      const node = createMockDockerNode({
        operation: "exec",
        container: "",
        command: "ls",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });

    it("should fail exec without command", async () => {
      const node = createMockDockerNode({
        operation: "exec",
        container: "myapp",
        command: "",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });
  });

  describe("execute — inspect operation", () => {
    it("should inspect container", async () => {
      const node = createMockDockerNode({
        operation: "inspect",
        container: "myapp",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: '[{"Id":"abc123","State":{"Running":true}}]',
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("Running");
      expect(run_shell_command).toHaveBeenCalledWith("docker inspect myapp", expect.any(Object));
    });

    it("should fail inspect without container", async () => {
      const node = createMockDockerNode({
        operation: "inspect",
        container: "",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });
  });

  describe("execute — unsupported operation", () => {
    it("should return error for unknown operation", async () => {
      const node = createMockDockerNode({
        operation: "unknown_op",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("unsupported");
    });
  });

  describe("execute — safety policy blocking", () => {
    it("should block --privileged flag", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "alpine",
        command: "id",
        args: "--privileged",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("blocked");
    });

    it("should block volume mount to root", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "alpine",
        command: "ls",
        args: "-v /:/mnt",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("blocked");
    });

    it("should block --pid host flag", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "alpine",
        args: "--pid host",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("blocked");
    });

    it("should block --net host flag", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "alpine",
        args: "--net host",
      });
      const ctx = createMockContext();

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("blocked");
    });
  });

  describe("execute — template variable resolution", () => {
    it("should resolve operation template", async () => {
      const node = createMockDockerNode({
        operation: "{{memory.docker_op}}",
      });
      const ctx = createMockContext({
        memory: { docker_op: "ps" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "containers",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });

    it("should resolve container template", async () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "{{memory.container_name}}",
      });
      const ctx = createMockContext({
        memory: { container_name: "myapp" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "app logs",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith(expect.stringContaining("myapp"), expect.any(Object));
    });

    it("should resolve image template", async () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "{{memory.image_name}}",
        command: "echo test",
      });
      const ctx = createMockContext({
        memory: { image_name: "ubuntu" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "test",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith(expect.stringContaining("ubuntu"), expect.any(Object));
    });

    it("should resolve command template", async () => {
      const node = createMockDockerNode({
        operation: "exec",
        container: "app",
        command: "{{memory.cmd}}",
      });
      const ctx = createMockContext({
        memory: { cmd: "npm start" },
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "server running",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(run_shell_command).toHaveBeenCalledWith(expect.stringContaining("npm start"), expect.any(Object));
    });
  });

  describe("execute — error handling", () => {
    it("should handle command execution error", async () => {
      const node = createMockDockerNode({
        operation: "ps",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockRejectedValueOnce(new Error("Docker not available"));

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.output).toContain("Docker not available");
    });

    it("should handle stderr output", async () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "nonexistent",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: No such container",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("Error: No such container");
    });

    it("should handle empty output", async () => {
      const node = createMockDockerNode({
        operation: "ps",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "",
        stderr: "",
      });

      const result = await docker_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toBe("(no output)");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid ps config", () => {
      const node = createMockDockerNode({
        operation: "ps",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when operation missing", () => {
      const node = createMockDockerNode({
        operation: "",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("operation is required");
    });

    it("should warn when stop missing container", () => {
      const node = createMockDockerNode({
        operation: "stop",
        container: "",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("container is required");
    });

    it("should warn when rm missing container", () => {
      const node = createMockDockerNode({
        operation: "rm",
        container: "",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("container is required");
    });

    it("should warn when logs missing container", () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("container is required");
    });

    it("should warn when exec missing container", () => {
      const node = createMockDockerNode({
        operation: "exec",
        container: "",
        command: "ls",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("container is required");
    });

    it("should warn when inspect missing container", () => {
      const node = createMockDockerNode({
        operation: "inspect",
        container: "",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("container is required");
    });

    it("should warn when run missing image", () => {
      const node = createMockDockerNode({
        operation: "run",
        image: "",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.warnings).toContain("image is required for run");
    });

    it("should include preview with operation and container", () => {
      const node = createMockDockerNode({
        operation: "logs",
        container: "myapp",
        image: "alpine",
      });
      const ctx = createMockContext();

      const result = docker_handler.test(node, ctx);

      expect(result.preview.operation).toBe("logs");
      expect(result.preview.container).toBe("myapp");
      expect(result.preview.image).toBe("alpine");
    });
  });

  describe("integration scenarios", () => {
    it("should list containers and get logs", async () => {
      // First: list containers
      const psNode = createMockDockerNode({
        operation: "ps",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "myapp\ndb\nweb",
        stderr: "",
      });

      let result = await docker_handler.execute(psNode, ctx);
      expect(result.output.success).toBe(true);

      // Second: get logs from first container
      const logsNode = createMockDockerNode({
        operation: "logs",
        container: "myapp",
        tail: 20,
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "Started...\nRunning...",
        stderr: "",
      });

      result = await docker_handler.execute(logsNode, ctx);
      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("Running");
    });

    it("should run container and then remove it", async () => {
      // Run container
      const runNode = createMockDockerNode({
        operation: "run",
        image: "alpine",
        command: "echo done",
      });
      const ctx = createMockContext();

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "done",
        stderr: "",
      });

      let result = await docker_handler.execute(runNode, ctx);
      expect(result.output.success).toBe(true);

      // Remove container
      const rmNode = createMockDockerNode({
        operation: "rm",
        container: "temp-container",
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "temp-container",
        stderr: "",
      });

      result = await docker_handler.execute(rmNode, ctx);
      expect(result.output.success).toBe(true);
    });

    it("should support multi-step container lifecycle", async () => {
      const ctx = createMockContext({
        memory: { container: "app-server" },
      });

      // Inspect
      let node = createMockDockerNode({
        operation: "inspect",
        container: "{{memory.container}}",
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: '[{"State":{"Running":true}}]',
        stderr: "",
      });

      let result = await docker_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);

      // Logs
      node = createMockDockerNode({
        operation: "logs",
        container: "{{memory.container}}",
        tail: 50,
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "app logs",
        stderr: "",
      });

      result = await docker_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);

      // Exec
      node = createMockDockerNode({
        operation: "exec",
        container: "{{memory.container}}",
        command: "health-check",
      });

      (run_shell_command as any).mockResolvedValueOnce({
        stdout: "healthy",
        stderr: "",
      });

      result = await docker_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
    });
  });
});
