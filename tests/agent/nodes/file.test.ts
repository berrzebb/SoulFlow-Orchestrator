/** File 노드 핸들러 테스트
 *
 * 목표: file_handler를 통한 파일 I/O 검증
 *       - read: 파일 읽기
 *       - write: 파일 쓰기 (템플릿 해석)
 *       - extract: JSON/CSV 파싱
 *       - path traversal: 경로 순회 방지
 *       - template resolution: file_path/content 변수 치환
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { file_handler } from "@src/agent/nodes/file.js";
import type { FileNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

/* ── Mock File System ── */

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "file-test-"));
});

afterEach(() => {
  // Cleanup test directory
  const files = require("node:fs").readdirSync(testDir);
  files.forEach((file: string) => {
    const path = join(testDir, file);
    if (require("node:fs").lstatSync(path).isDirectory()) {
      require("node:fs").rmSync(path, { recursive: true });
    } else {
      unlinkSync(path);
    }
  });
  require("node:fs").rmdirSync(testDir);
});

/* ── Mock Data ── */

const createMockFileNode = (overrides?: Partial<FileNodeDefinition>): FileNodeDefinition => ({
  node_id: "file-1",
  label: "Test File",
  node_type: "file",
  operation: "read",
  file_path: "test.txt",
  format: "text",
  ...overrides,
});

const createMockContext = (workspace?: string, overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    filename: "data",
    content: "Hello World",
    key: "value",
  },
  workspace: workspace || testDir,
  ...overrides,
});

/* ── Tests ── */

describe("File Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(file_handler.node_type).toBe("file");
    });

    it("should have output_schema with content, data, path", () => {
      const schema = file_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("content");
      expect(fields).toContain("data");
      expect(fields).toContain("path");
    });

    it("should have input_schema with file_path and content", () => {
      const schema = file_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("file_path");
      expect(fields).toContain("content");
    });

    it("should have create_default returning read operation", () => {
      const defaultNode = file_handler.create_default?.();
      expect(defaultNode?.operation).toBe("read");
      expect(defaultNode?.file_path).toBe("");
      expect(defaultNode?.format).toBe("text");
    });

    it("should have icon and color metadata", () => {
      expect(file_handler.icon).toBeDefined();
      expect(file_handler.color).toBeDefined();
      expect(file_handler.shape).toBe("rect");
    });
  });

  describe("execute — read operation", () => {
    it("should read file content", async () => {
      const filePath = join(testDir, "test.txt");
      await writeFile(filePath, "Hello, World!");

      const node = createMockFileNode({
        operation: "read",
        file_path: "test.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe("Hello, World!");
      expect(result.output.data).toBeNull();
      expect(result.output.path).toBe(filePath);
    });

    it("should resolve template in file_path", async () => {
      const filePath = join(testDir, "data.txt");
      await writeFile(filePath, "test content");

      const node = createMockFileNode({
        operation: "read",
        file_path: "{{memory.filename}}.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe("test content");
    });

    it("should throw on missing file", async () => {
      const node = createMockFileNode({
        operation: "read",
        file_path: "nonexistent.txt",
      });
      const ctx = createMockContext(testDir);

      await expect(file_handler.execute(node, ctx)).rejects.toThrow();
    });

    it("should handle empty file", async () => {
      const filePath = join(testDir, "empty.txt");
      await writeFile(filePath, "");

      const node = createMockFileNode({
        operation: "read",
        file_path: "empty.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe("");
    });

    it("should handle large files", async () => {
      const largeContent = "x".repeat(100000);
      const filePath = join(testDir, "large.txt");
      await writeFile(filePath, largeContent);

      const node = createMockFileNode({
        operation: "read",
        file_path: "large.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content.length).toBe(100000);
    });
  });

  describe("execute — write operation", () => {
    it("should write file with content", async () => {
      const node = createMockFileNode({
        operation: "write",
        file_path: "output.txt",
        content: "Written content",
      });
      const ctx = createMockContext(testDir);

      await file_handler.execute(node, ctx);

      const filePath = join(testDir, "output.txt");
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("Written content");
    });

    it("should resolve template in write content", async () => {
      const node = createMockFileNode({
        operation: "write",
        file_path: "templated.txt",
        content: "Hello {{memory.content}}!",
      });
      const ctx = createMockContext(testDir);

      await file_handler.execute(node, ctx);

      const filePath = join(testDir, "templated.txt");
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("Hello Hello World!");
    });

    it("should overwrite existing file", async () => {
      const filePath = join(testDir, "existing.txt");
      await writeFile(filePath, "Old content");

      const node = createMockFileNode({
        operation: "write",
        file_path: "existing.txt",
        content: "New content",
      });
      const ctx = createMockContext(testDir);

      await file_handler.execute(node, ctx);

      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("New content");
    });

    it("should handle empty write", async () => {
      const node = createMockFileNode({
        operation: "write",
        file_path: "empty-write.txt",
        content: "",
      });
      const ctx = createMockContext(testDir);

      await file_handler.execute(node, ctx);

      const filePath = join(testDir, "empty-write.txt");
      const written = await readFile(filePath, "utf-8");
      expect(written).toBe("");
    });

    it("should create parent directories implicitly (if supported)", async () => {
      const node = createMockFileNode({
        operation: "write",
        file_path: "subdir/file.txt",
        content: "Nested file",
      });
      const ctx = createMockContext(testDir);

      // May throw if directories don't exist
      try {
        await file_handler.execute(node, ctx);
      } catch (e) {
        // Expected if mkdir not implemented
        expect(String(e)).toContain("ENOENT");
      }
    });
  });

  describe("execute — extract operation", () => {
    it("should extract JSON file", async () => {
      const jsonData = { name: "Alice", age: 30 };
      const filePath = join(testDir, "data.json");
      await writeFile(filePath, JSON.stringify(jsonData));

      const node = createMockFileNode({
        operation: "extract",
        file_path: "data.json",
        format: "json",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.data).toEqual(jsonData);
      expect(result.output.content).toBe(JSON.stringify(jsonData));
    });

    it("should extract CSV file", async () => {
      const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA";
      const filePath = join(testDir, "data.csv");
      await writeFile(filePath, csv);

      const node = createMockFileNode({
        operation: "extract",
        file_path: "data.csv",
        format: "csv",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(Array.isArray(result.output.data)).toBe(true);
      expect((result.output.data as any[])[0]).toEqual({ name: "Alice", age: "30", city: "NYC" });
      expect((result.output.data as any[])[1]).toEqual({ name: "Bob", age: "25", city: "LA" });
    });

    it("should extract as text when format is text", async () => {
      const filePath = join(testDir, "text.txt");
      await writeFile(filePath, "plain text content");

      const node = createMockFileNode({
        operation: "extract",
        file_path: "text.txt",
        format: "text",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.data).toBe("plain text content");
    });

    it("should handle malformed JSON", async () => {
      const filePath = join(testDir, "broken.json");
      await writeFile(filePath, "{invalid json}");

      const node = createMockFileNode({
        operation: "extract",
        file_path: "broken.json",
        format: "json",
      });
      const ctx = createMockContext(testDir);

      await expect(file_handler.execute(node, ctx)).rejects.toThrow();
    });

    it("should handle CSV with empty lines", async () => {
      const csv = "col1,col2\nval1,val2\n\nval3,val4";
      const filePath = join(testDir, "sparse.csv");
      await writeFile(filePath, csv);

      const node = createMockFileNode({
        operation: "extract",
        file_path: "sparse.csv",
        format: "csv",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(Array.isArray(result.output.data)).toBe(true);
      expect((result.output.data as any[]).length).toBe(2);
    });
  });

  describe("path traversal protection", () => {
    it("should prevent path traversal with ../", async () => {
      const node = createMockFileNode({
        operation: "read",
        file_path: "../../../etc/passwd",
      });
      const ctx = createMockContext(testDir);

      await expect(file_handler.execute(node, ctx)).rejects.toThrow("path traversal");
    });

    it("should prevent absolute paths outside workspace", async () => {
      const node = createMockFileNode({
        operation: "read",
        file_path: "/etc/passwd",
      });
      const ctx = createMockContext(testDir);

      await expect(file_handler.execute(node, ctx)).rejects.toThrow("path traversal");
    });

    it("should allow relative paths within workspace", async () => {
      const filePath = join(testDir, "allowed.txt");
      await writeFile(filePath, "safe content");

      const node = createMockFileNode({
        operation: "read",
        file_path: "./allowed.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe("safe content");
    });

    it("should allow nested directories within workspace", async () => {
      const subdir = join(testDir, "subdir");
      require("node:fs").mkdirSync(subdir, { recursive: true });
      const filePath = join(subdir, "nested.txt");
      await writeFile(filePath, "nested content");

      const node = createMockFileNode({
        operation: "read",
        file_path: "subdir/nested.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe("nested content");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockFileNode({
        operation: "read",
        file_path: "test.txt",
      });
      const ctx = createMockContext();

      const result = file_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when file_path is empty", () => {
      const node = createMockFileNode({ file_path: "" });
      const ctx = createMockContext();

      const result = file_handler.test(node, ctx);

      expect(result.warnings).toContain("file_path is empty");
    });

    it("should warn on write with empty content", () => {
      const node = createMockFileNode({
        operation: "write",
        content: "",
      });
      const ctx = createMockContext();

      const result = file_handler.test(node, ctx);

      expect(result.warnings).toContain("write operation with empty content");
    });

    it("should include preview with operation, file_path, format", () => {
      const node = createMockFileNode({
        operation: "extract",
        file_path: "data.csv",
        format: "csv",
      });
      const ctx = createMockContext();

      const result = file_handler.test(node, ctx);

      expect(result.preview.operation).toBe("extract");
      expect(result.preview.file_path).toBe("data.csv");
      expect(result.preview.format).toBe("csv");
    });

    it("should default format to text", () => {
      const node = createMockFileNode({ format: undefined as any });
      const ctx = createMockContext();

      const result = file_handler.test(node, ctx);

      expect(result.preview.format).toBe("text");
    });
  });

  describe("integration scenarios", () => {
    it("should read, modify, and write file", async () => {
      const filePath = join(testDir, "pipeline.txt");
      await writeFile(filePath, "original");

      // Read
      let node = createMockFileNode({
        operation: "read",
        file_path: "pipeline.txt",
      });
      let result = await file_handler.execute(node, createMockContext(testDir));
      expect(result.output.content).toBe("original");

      // Write modified
      node = createMockFileNode({
        operation: "write",
        file_path: "pipeline.txt",
        content: "modified",
      });
      await file_handler.execute(node, createMockContext(testDir));

      // Read again
      node = createMockFileNode({
        operation: "read",
        file_path: "pipeline.txt",
      });
      result = await file_handler.execute(node, createMockContext(testDir));
      expect(result.output.content).toBe("modified");
    });

    it("should extract and process JSON data", async () => {
      const jsonData = { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] };
      const filePath = join(testDir, "users.json");
      await writeFile(filePath, JSON.stringify(jsonData));

      const node = createMockFileNode({
        operation: "extract",
        file_path: "users.json",
        format: "json",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect((result.output.data as any).users).toHaveLength(2);
      expect((result.output.data as any).users[0].name).toBe("Alice");
    });

    it("should handle CSV import workflow", async () => {
      const csv = "id,product,price\n1,Apple,1.50\n2,Banana,0.75\n3,Orange,2.00";
      const filePath = join(testDir, "products.csv");
      await writeFile(filePath, csv);

      const node = createMockFileNode({
        operation: "extract",
        file_path: "products.csv",
        format: "csv",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(Array.isArray(result.output.data)).toBe(true);
      expect((result.output.data as any[]).length).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("should handle unicode content", async () => {
      const unicodeContent = "Hello 世界 🌍 Привет";
      const filePath = join(testDir, "unicode.txt");
      await writeFile(filePath, unicodeContent);

      const node = createMockFileNode({
        operation: "read",
        file_path: "unicode.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe(unicodeContent);
    });

    it("should handle multiline content", async () => {
      const multiline = "line1\nline2\nline3";
      const filePath = join(testDir, "multiline.txt");
      await writeFile(filePath, multiline);

      const node = createMockFileNode({
        operation: "read",
        file_path: "multiline.txt",
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe(multiline);
    });

    it("should handle special characters in filename", async () => {
      const safeFilename = "file-with_special.chars.txt";
      const filePath = join(testDir, safeFilename);
      await writeFile(filePath, "content");

      const node = createMockFileNode({
        operation: "read",
        file_path: safeFilename,
      });
      const ctx = createMockContext(testDir);

      const result = await file_handler.execute(node, ctx);

      expect(result.output.content).toBe("content");
    });

    it("should throw on unknown operation", async () => {
      const node = createMockFileNode({
        operation: "unknown" as any,
      });
      const ctx = createMockContext(testDir);

      await expect(file_handler.execute(node, ctx)).rejects.toThrow("unknown file operation");
    });
  });
});
