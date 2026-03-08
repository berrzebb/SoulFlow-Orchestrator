/** Media 노드 핸들러 테스트
 *
 * 목표: media_handler를 통한 미디어 타입 감지 및 처리 검증
 *       - detect_type: MIME 타입 감지
 *       - extract_metadata: 파일 메타데이터 추출
 *       - to_base64: 파일 → data URI 변환
 *       - from_base64: data URI → 파일 변환
 *       - path traversal 방지
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { media_handler } from "@src/agent/nodes/media.js";
import type { MediaNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

import { readFile, writeFile, stat } from "node:fs/promises";

/* ── Mock Data ── */

const createMockMediaNode = (overrides?: Partial<MediaNodeDefinition>): MediaNodeDefinition => ({
  node_id: "media-1",
  title: "Test Media Node",
  node_type: "media",
  operation: "detect_type",
  input_path: "",
  output_path: "",
  target_format: "",
  mime_type: "",
  thumb_width: 200,
  thumb_height: 200,
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
  },
  workspace: "/workspace",
  ...overrides,
});

/* ── Tests ── */

describe("Media Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(media_handler.node_type).toBe("media");
    });

    it("should have output_schema with mime_type, category, metadata, result, success", () => {
      const schema = media_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("mime_type");
      expect(fields).toContain("category");
      expect(fields).toContain("metadata");
      expect(fields).toContain("result");
      expect(fields).toContain("success");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = media_handler.create_default?.();
      expect(defaultNode?.operation).toBe("detect_type");
      expect(defaultNode?.thumb_width).toBe(200);
    });
  });

  describe("execute — detect_type operation", () => {
    it("should detect jpeg image type", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "image.jpg",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.mime_type).toBe("image/jpeg");
      expect(result.output.category).toBe("image");
    });

    it("should detect png image type", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "photo.png",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.mime_type).toBe("image/png");
    });

    it("should detect mp3 audio type", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "song.mp3",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.mime_type).toBe("audio/mpeg");
      expect(result.output.category).toBe("audio");
    });

    it("should detect mp4 video type", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "video.mp4",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.mime_type).toBe("video/mp4");
      expect(result.output.category).toBe("video");
    });

    it("should detect pdf document type", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "document.pdf",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.mime_type).toBe("application/pdf");
      expect(result.output.category).toBe("document");
    });

    it("should default to application/octet-stream for unknown types", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "unknown.xyz",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.mime_type).toBe("application/octet-stream");
    });
  });

  describe("execute — extract_metadata operation", () => {
    it("should extract file metadata", async () => {
      const node = createMockMediaNode({
        operation: "extract_metadata",
        input_path: "image.jpg",
      });
      const ctx = createMockContext();

      (stat as any).mockResolvedValueOnce({
        size: 102400,
        birthtime: new Date("2024-01-01"),
        mtime: new Date("2024-01-15"),
      });

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.metadata.size_bytes).toBe(102400);
      expect(result.output.metadata.size_human).toContain("KB");
    });

    it("should include file name and extension", async () => {
      const node = createMockMediaNode({
        operation: "extract_metadata",
        input_path: "document.pdf",
      });
      const ctx = createMockContext();

      (stat as any).mockResolvedValueOnce({
        size: 51200,
        birthtime: new Date("2024-01-01"),
        mtime: new Date("2024-01-01"),
      });

      const result = await media_handler.execute(node, ctx);

      expect(result.output.metadata.name).toBe("document.pdf");
      expect(result.output.metadata.ext).toBe(".pdf");
    });

    it("should handle file stat errors gracefully", async () => {
      const node = createMockMediaNode({
        operation: "extract_metadata",
        input_path: "nonexistent.jpg",
      });
      const ctx = createMockContext();

      (stat as any).mockRejectedValueOnce(new Error("ENOENT: no such file"));

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.result).toContain("no such file");
    });
  });

  describe("execute — to_base64 operation", () => {
    it("should convert file to base64 data URI", async () => {
      const node = createMockMediaNode({
        operation: "to_base64",
        input_path: "image.png",
      });
      const ctx = createMockContext();

      const buffer = Buffer.from("PNG_DATA");
      (readFile as any).mockResolvedValueOnce(buffer);

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("data:image/png;base64,");
      expect(result.output.metadata.size_bytes).toBe(buffer.length);
    });

    it("should use explicit mime_type if provided", async () => {
      const node = createMockMediaNode({
        operation: "to_base64",
        input_path: "file.bin",
        mime_type: "image/jpeg",
      });
      const ctx = createMockContext();

      const buffer = Buffer.from("IMAGE_DATA");
      (readFile as any).mockResolvedValueOnce(buffer);

      const result = await media_handler.execute(node, ctx);

      expect(result.output.result).toContain("data:image/jpeg;base64,");
    });
  });

  describe("execute — from_base64 operation", () => {
    it("should decode base64 data to file", async () => {
      const node = createMockMediaNode({
        operation: "from_base64",
        input_path: "data:image/png;base64,aW1hZ2VkYXRh",
        output_path: "output.png",
      });
      const ctx = createMockContext();

      (writeFile as any).mockResolvedValueOnce(undefined);

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(writeFile).toHaveBeenCalled();
    });

    it("should accept raw base64 without data URI format", async () => {
      const node = createMockMediaNode({
        operation: "from_base64",
        input_path: "aW1hZ2VkYXRh",
        output_path: "output.bin",
      });
      const ctx = createMockContext();

      (writeFile as any).mockResolvedValueOnce(undefined);

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });

    it("should use default output path when not specified", async () => {
      const node = createMockMediaNode({
        operation: "from_base64",
        input_path: "YmFzZTY0ZGF0YQ==",
        output_path: "",
      });
      const ctx = createMockContext();

      (writeFile as any).mockResolvedValueOnce(undefined);

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });
  });

  describe("execute — template variable resolution", () => {
    it("should resolve input_path template", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "{{memory.file}}",
      });
      const ctx = createMockContext({
        memory: { file: "test.jpg" },
      });

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });

    it("should resolve output_path template", async () => {
      const node = createMockMediaNode({
        operation: "from_base64",
        input_path: "YmFzZTY0",
        output_path: "{{memory.output}}.png",
      });
      const ctx = createMockContext({
        memory: { output: "result" },
      });

      (writeFile as any).mockResolvedValueOnce(undefined);

      await media_handler.execute(node, ctx);

      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe("execute — unsupported operation", () => {
    it("should return error for unknown operation", async () => {
      const node = createMockMediaNode({
        operation: "unknown_op",
      });
      const ctx = createMockContext();

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.result).toContain("Unknown operation");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for detect_type", () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "file.jpg",
      });
      const ctx = createMockContext();

      const result = media_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when input_path missing for detect_type", () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "",
      });
      const ctx = createMockContext();

      const result = media_handler.test(node, ctx);

      expect(result.warnings).toContain("input_path is required");
    });

    it("should warn when output_path missing for from_base64", () => {
      const node = createMockMediaNode({
        operation: "from_base64",
        output_path: "",
      });
      const ctx = createMockContext();

      const result = media_handler.test(node, ctx);

      expect(result.warnings).toContain("output_path is required for from_base64");
    });

    it("should not require input_path for from_base64", () => {
      const node = createMockMediaNode({
        operation: "from_base64",
        input_path: "",
        output_path: "out.bin",
      });
      const ctx = createMockContext();

      const result = media_handler.test(node, ctx);

      expect(result.warnings).not.toContain("input_path is required");
    });

    it("should include operation in preview", () => {
      const node = createMockMediaNode({
        operation: "extract_metadata",
      });
      const ctx = createMockContext();

      const result = media_handler.test(node, ctx);

      expect(result.preview.operation).toBe("extract_metadata");
    });
  });

  describe("integration scenarios", () => {
    it("should detect and extract metadata in sequence", async () => {
      const node = createMockMediaNode({
        operation: "extract_metadata",
        input_path: "photo.jpg",
      });
      const ctx = createMockContext();

      (stat as any).mockResolvedValueOnce({
        size: 1024 * 1024 * 5, // 5 MB
        birthtime: new Date(),
        mtime: new Date(),
      });

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.mime_type).toBe("image/jpeg");
      expect(result.output.category).toBe("image");
      expect(result.output.metadata.size_human).toContain("MB");
    });

    it("should convert image file to data URI", async () => {
      const node = createMockMediaNode({
        operation: "to_base64",
        input_path: "avatar.png",
      });
      const ctx = createMockContext();

      const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      (readFile as any).mockResolvedValueOnce(pngData);

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toMatch(/^data:image\/png;base64,/);
    });

    it("should handle round-trip base64 conversion", async () => {
      // to_base64
      const toBase64Node = createMockMediaNode({
        operation: "to_base64",
        input_path: "original.txt",
      });
      const ctx = createMockContext();

      const originalData = Buffer.from("test content");
      (readFile as any).mockResolvedValueOnce(originalData);

      const encodeResult = await media_handler.execute(toBase64Node, ctx);
      expect(encodeResult.output.success).toBe(true);

      // from_base64
      const fromBase64Node = createMockMediaNode({
        operation: "from_base64",
        input_path: encodeResult.output.result,
        output_path: "restored.txt",
      });

      (writeFile as any).mockResolvedValueOnce(undefined);

      const decodeResult = await media_handler.execute(fromBase64Node, ctx);
      expect(decodeResult.output.success).toBe(true);
    });

    it("should process audio file metadata", async () => {
      const node = createMockMediaNode({
        operation: "extract_metadata",
        input_path: "song.wav",
      });
      const ctx = createMockContext();

      (stat as any).mockResolvedValueOnce({
        size: 1024 * 100,
        birthtime: new Date(),
        mtime: new Date(),
      });

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.mime_type).toBe("audio/wav");
      expect(result.output.category).toBe("audio");
    });

    it("should support workspace-relative paths", async () => {
      const node = createMockMediaNode({
        operation: "detect_type",
        input_path: "assets/image.webp",
      });
      const ctx = createMockContext({
        workspace: "/app/project",
      });

      const result = await media_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.mime_type).toBe("image/webp");
    });
  });
});
