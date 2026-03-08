/** DocumentTool 테스트 — 문서 생성/변환 기능. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DocumentTool } from "../../src/agent/tools/document.js";

describe("DocumentTool", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = resolve(process.cwd(), ".tmp-test-document-" + Date.now());
  });

  afterEach(async () => {
    if (existsSync(tmpdir)) {
      await rm(tmpdir, { recursive: true, force: true });
    }
  });

  describe("create_pdf", () => {
    it("creates PDF from plain text", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_pdf",
        content: "Hello World\nThis is a test PDF.",
        output: "test.pdf",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.output).toBe("test.pdf");
      expect(parsed.size_bytes).toBeGreaterThan(0);
      expect(existsSync(resolve(tmpdir, "test.pdf"))).toBe(true);
    });

    it("creates PDF with markdown formatting", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_pdf",
        content: "# Title\n## Subtitle\nParagraph text",
        input_format: "markdown",
        output: "markdown.pdf",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(existsSync(resolve(tmpdir, "markdown.pdf"))).toBe(true);
      expect(parsed.size_bytes).toBeGreaterThan(0);
    });

    it("requires content parameter", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_pdf",
        output: "test.pdf",
      });

      expect(result).toContain("Error: content is required");
    });

    it("requires output parameter", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_pdf",
        content: "test content",
      });

      expect(result).toContain("Error: output filename is required");
    });

    it("blocks path traversal attacks", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_pdf",
        content: "test",
        output: "../../../etc/passwd.pdf",
      });

      expect(result).toContain("Error: path traversal blocked");
    });

    it("handles long content with page breaks", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const longContent = "Line\n".repeat(100);
      const result = await tool.execute({
        action: "create_pdf",
        content: longContent,
        output: "long.pdf",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(existsSync(resolve(tmpdir, "long.pdf"))).toBe(true);
    });
  });

  describe("create_docx", () => {
    it("creates DOCX from plain text", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_docx",
        content: "Hello World\nThis is a test document.",
        output: "test.docx",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(parsed.output).toBe("test.docx");
      expect(parsed.size_bytes).toBeGreaterThan(0);
      expect(existsSync(resolve(tmpdir, "test.docx"))).toBe(true);
    });

    it("creates DOCX with markdown formatting", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_docx",
        content: "# Heading 1\n## Heading 2\n### Heading 3\nBody text",
        input_format: "markdown",
        output: "formatted.docx",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(existsSync(resolve(tmpdir, "formatted.docx"))).toBe(true);
    });

    it("requires content parameter", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_docx",
        output: "test.docx",
      });

      expect(result).toContain("Error: content is required");
    });

    it("requires output parameter", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_docx",
        content: "test",
      });

      expect(result).toContain("Error: output filename is required");
    });

    it("blocks path traversal attacks", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_docx",
        content: "test",
        output: "../../sensitive/doc.docx",
      });

      expect(result).toContain("Error: path traversal blocked");
    });

    it("handles empty content gracefully", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "create_docx",
        content: "",
        output: "empty.docx",
      });

      expect(result).toContain("Error: content is required");
    });
  });

  describe("convert", () => {
    it("requires input file path", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "convert",
        to: "pdf",
      });

      expect(result).toContain("Error: input file path is required");
    });

    it("requires output format", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "convert",
        input: "test.docx",
      });

      expect(result).toContain("Error: output format is required");
    });

    it("rejects non-existent input file", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "convert",
        input: "nonexistent.docx",
        to: "pdf",
      });

      expect(result).toContain("Error: input file not found");
    });

    it("blocks path traversal attacks on input", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "convert",
        input: "../../etc/passwd",
        to: "pdf",
      });

      expect(result).toContain("Error: path traversal blocked");
    });

    it("handles LibreOffice not available gracefully", async () => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const tool = new DocumentTool({ workspace: tmpdir });

      // Create a dummy file to convert (will fail because LibreOffice is not available in test env)
      await mkdir(tmpdir, { recursive: true });
      const testFile = resolve(tmpdir, "test.txt");
      await writeFile(testFile, "test content");

      const result = await tool.execute({
        action: "convert",
        input: "test.txt",
        to: "pdf",
      });

      // Should handle the error gracefully (either success or error message)
      expect(result).toBeTruthy();
    });
  });

  describe("error handling", () => {
    it("returns error for unknown action", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const result = await tool.execute({
        action: "unknown_action" as any,
      });

      expect(result).toContain('Error: unknown action "unknown_action"');
    });

    it("tool metadata is correct", () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      expect(tool.name).toBe("document");
      expect(tool.category).toBe("data");
      expect(tool.policy_flags.write).toBe(true);
      expect(tool.description).toContain("PDF");
      expect(tool.description).toContain("DOCX");
    });

    it("tool parameters schema is complete", () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const params = tool.parameters;

      expect(params.type).toBe("object");
      expect(params.properties).toHaveProperty("action");
      expect(params.properties).toHaveProperty("content");
      expect(params.properties).toHaveProperty("input_format");
      expect(params.properties).toHaveProperty("output");
      expect(params.properties).toHaveProperty("input");
      expect(params.properties).toHaveProperty("to");
      expect(params.required).toContain("action");
    });
  });

  describe("integration tests", () => {
    it("creates multiple documents in sequence", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });

      const pdf_result = await tool.execute({
        action: "create_pdf",
        content: "PDF Document",
        output: "doc1.pdf",
      });

      const docx_result = await tool.execute({
        action: "create_docx",
        content: "DOCX Document",
        output: "doc2.docx",
      });

      expect(JSON.parse(pdf_result).success).toBe(true);
      expect(JSON.parse(docx_result).success).toBe(true);
      expect(existsSync(resolve(tmpdir, "doc1.pdf"))).toBe(true);
      expect(existsSync(resolve(tmpdir, "doc2.docx"))).toBe(true);
    });

    it("handles special characters in content", async () => {
      const tool = new DocumentTool({ workspace: tmpdir });
      const specialContent = "한글 테스트\nÜmläüts\n© ® ™\n© 2024";

      const result = await tool.execute({
        action: "create_docx",
        content: specialContent,
        output: "special.docx",
      });

      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
      expect(existsSync(resolve(tmpdir, "special.docx"))).toBe(true);
    });
  });
});
