/** Archive 노드 핸들러 테스트
 *
 * 목표: archive_handler를 통한 tar/zip 조작 검증
 *       - create/extract/list 연산
 *       - tar.gz/zip 포맷 지원
 *       - shell 명령어 빌드 및 실행
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { archive_handler } from "@src/agent/nodes/archive.js";
import type { ArchiveNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

import { run_shell_command } from "@src/agent/tools/shell-runtime.js";

const createMockArchiveNode = (overrides?: Partial<ArchiveNodeDefinition>): ArchiveNodeDefinition => ({
  node_id: "archive-1",
  label: "Test Archive",
  node_type: "archive",
  operation: "list",
  format: "tar.gz",
  archive_path: "test.tar.gz",
  files: "",
  output_dir: ".",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    workspace_id: "workspace-1",
  },
  workspace: "/tmp/workspace",
  abort_signal: new AbortController().signal,
  ...overrides,
});

describe("Archive Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(archive_handler.node_type).toBe("archive");
    });

    it("should have output_schema with output and success", () => {
      const schema = archive_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("output");
      expect(fields).toContain("success");
    });

    it("should have create_default with list operation", () => {
      const defaultNode = archive_handler.create_default?.();
      expect(defaultNode?.operation).toBe("list");
      expect(defaultNode?.format).toBe("tar.gz");
    });
  });

  describe("execute — list operation", () => {
    it("should list tar.gz archive contents", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        format: "tar.gz",
        archive_path: "data.tar.gz",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "file1\nfile2\n", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("file");
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("tar tzf"), expect.any(Object));
    });

    it("should list zip archive contents", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        format: "zip",
        archive_path: "data.zip",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "Archive:\nfile1.txt\n", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("unzip -l"), expect.any(Object));
    });
  });

  describe("execute — create operation", () => {
    it("should create tar.gz archive", async () => {
      const node = createMockArchiveNode({
        operation: "create",
        format: "tar.gz",
        archive_path: "backup.tar.gz",
        files: "dir/",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("tar czf"), expect.any(Object));
    });

    it("should create zip archive", async () => {
      const node = createMockArchiveNode({
        operation: "create",
        format: "zip",
        archive_path: "backup.zip",
        files: "dir/",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("zip -r"), expect.any(Object));
    });

    it("should fail without files for create", async () => {
      const node = createMockArchiveNode({
        operation: "create",
        format: "tar.gz",
        archive_path: "backup.tar.gz",
        files: "",
      });
      const ctx = createMockContext();

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("unsupported");
    });
  });

  describe("execute — extract operation", () => {
    it("should extract tar.gz archive", async () => {
      const node = createMockArchiveNode({
        operation: "extract",
        format: "tar.gz",
        archive_path: "backup.tar.gz",
        output_dir: "./extracted",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("tar xzf"), expect.any(Object));
    });

    it("should extract zip archive", async () => {
      const node = createMockArchiveNode({
        operation: "extract",
        format: "zip",
        archive_path: "backup.zip",
        output_dir: "./extracted",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(mockRun).toHaveBeenCalledWith(expect.stringContaining("unzip"), expect.any(Object));
    });

    it("should use current dir as default output_dir", async () => {
      const node = createMockArchiveNode({
        operation: "extract",
        format: "tar.gz",
        archive_path: "data.tar.gz",
        output_dir: ".",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      await archive_handler.execute(node, ctx);

      const command = (mockRun.mock.calls[0] as any[])[0];
      expect(command).toContain(".");
    });
  });

  describe("execute — error handling", () => {
    it("should return error when archive_path missing", async () => {
      const node = createMockArchiveNode({
        archive_path: "",
      });
      const ctx = createMockContext();

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("required");
    });

    it("should return error when operation fails", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        archive_path: "nonexistent.tar.gz",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockRejectedValue(new Error("File not found"));

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.output).toContain("File not found");
    });

    it("should handle unsupported format", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        format: "rar" as any,
        archive_path: "data.rar",
      });
      const ctx = createMockContext();

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect((result.output as any).error).toContain("unsupported");
    });
  });

  describe("execute — template resolution", () => {
    it("should resolve template in archive_path", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        archive_path: "backup-{{memory.workspace_id}}.tar.gz",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      await archive_handler.execute(node, ctx);

      const command = (mockRun.mock.calls[0] as any[])[0];
      expect(command).toContain("backup-workspace-1");
    });

    it("should resolve template in files", async () => {
      const node = createMockArchiveNode({
        operation: "create",
        archive_path: "backup.tar.gz",
        files: "/path/to/{{memory.workspace_id}}/",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      await archive_handler.execute(node, ctx);

      const command = (mockRun.mock.calls[0] as any[])[0];
      expect(command).toContain("workspace-1");
    });
  });

  describe("execute — command output", () => {
    it("should return stdout and stderr combined", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        archive_path: "data.tar.gz",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "file1\nfile2", stderr: "warning" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("file1");
      expect(result.output.output).toContain("warning");
    });

    it("should return operation completed when no output", async () => {
      const node = createMockArchiveNode({
        operation: "create",
        archive_path: "backup.tar.gz",
        files: "dir/",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      const result = await archive_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.output).toContain("completed");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockArchiveNode({
        operation: "list",
        archive_path: "data.tar.gz",
      });
      const ctx = createMockContext();

      const result = archive_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when archive_path missing", () => {
      const node = createMockArchiveNode({
        archive_path: "",
      });
      const ctx = createMockContext();

      const result = archive_handler.test(node, ctx);

      expect(result.warnings).toContain("archive_path is required");
    });

    it("should warn when files missing for create", () => {
      const node = createMockArchiveNode({
        operation: "create",
        files: "",
      });
      const ctx = createMockContext();

      const result = archive_handler.test(node, ctx);

      expect(result.warnings).toContain("files are required for create");
    });

    it("should include preview", () => {
      const node = createMockArchiveNode({
        operation: "extract",
        format: "zip",
        archive_path: "data.zip",
      });
      const ctx = createMockContext();

      const result = archive_handler.test(node, ctx);

      expect(result.preview.operation).toBe("extract");
      expect(result.preview.format).toBe("zip");
      expect(result.preview.archive_path).toBe("data.zip");
    });
  });

  describe("edge cases", () => {
    it("should handle paths with spaces", async () => {
      const node = createMockArchiveNode({
        operation: "list",
        archive_path: "my archive.tar.gz",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      await archive_handler.execute(node, ctx);

      const command = (mockRun.mock.calls[0] as any[])[0];
      expect(command).toContain('"my archive.tar.gz"');
    });

    it("should handle multiple files", async () => {
      const node = createMockArchiveNode({
        operation: "create",
        archive_path: "backup.tar.gz",
        files: "dir1/ dir2/ file.txt",
      });
      const ctx = createMockContext();
      const mockRun = run_shell_command as any;
      mockRun.mockResolvedValue({ stdout: "", stderr: "" });

      await archive_handler.execute(node, ctx);

      const command = (mockRun.mock.calls[0] as any[])[0];
      expect(command).toContain("dir1/");
      expect(command).toContain("dir2/");
    });
  });
});
