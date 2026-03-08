/** Encoding 노드 핸들러 테스트
 *
 * 목표: encoding_handler를 통한 인코딩/디코딩/해시/UUID 검증
 *       - operations: encode, decode, hash, uuid
 *       - formats: base64, hex, url (encode/decode), sha256, sha512, md5 (hash)
 *       - template variable resolution: {{memory.*}} 경로 접근
 *       - error handling: invalid inputs, edge cases
 */

import { describe, it, expect } from "vitest";
import { encoding_handler } from "@src/agent/nodes/encoding.js";
import type { EncodingNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockEncodingNode = (overrides?: Partial<EncodingNodeDefinition>): EncodingNodeDefinition => ({
  node_id: "encoding-1",
  title: "Test Encoding Node",
  node_type: "encoding",
  operation: "encode",
  input: "",
  format: "base64",
  count: 1,
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

describe("Encoding Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(encoding_handler.node_type).toBe("encoding");
    });

    it("should have output_schema with result and success", () => {
      const schema = encoding_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("success");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = encoding_handler.create_default?.();
      expect(defaultNode?.operation).toBe("encode");
      expect(defaultNode?.format).toBe("base64");
    });
  });

  describe("execute — encode operation (base64)", () => {
    it("should encode string to base64", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "hello world",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(Buffer.from("hello world").toString("base64"));
    });

    it("should encode empty string", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("");
    });

    it("should encode unicode characters", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "你好世界 🌍",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(Buffer.from("你好世界 🌍").toString("base64"));
    });

    it("should encode special characters", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "!@#$%^&*()",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const expected = Buffer.from("!@#$%^&*()").toString("base64");
      expect(result.output.result).toBe(expected);
    });
  });

  describe("execute — encode operation (hex)", () => {
    it("should encode string to hex", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "hex",
        input: "hello",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(Buffer.from("hello").toString("hex"));
    });

    it("should encode special characters to hex", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "hex",
        input: "\x00\x01\x02",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("000102");
    });
  });

  describe("execute — encode operation (url)", () => {
    it("should encode URL component", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "url",
        input: "hello world & special/chars",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(encodeURIComponent("hello world & special/chars"));
    });

    it("should encode email for URL", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "url",
        input: "user@example.com",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("%40"); // @ encoded
    });

    it("should handle URL with query parameters", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "url",
        input: "name=John&age=30",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("%3D"); // = encoded
      expect(result.output.result).toContain("%26"); // & encoded
    });
  });

  describe("execute — decode operation (base64)", () => {
    it("should decode base64 to string", async () => {
      const input = Buffer.from("hello world").toString("base64");
      const node = createMockEncodingNode({
        operation: "decode",
        format: "base64",
        input,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("hello world");
    });

    it("should decode unicode from base64", async () => {
      const input = Buffer.from("你好").toString("base64");
      const node = createMockEncodingNode({
        operation: "decode",
        format: "base64",
        input,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("你好");
    });

    it("should handle invalid base64 gracefully", async () => {
      const node = createMockEncodingNode({
        operation: "decode",
        format: "base64",
        input: "!!!invalid!!!",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true); // No exception thrown
    });
  });

  describe("execute — decode operation (hex)", () => {
    it("should decode hex to string", async () => {
      const input = Buffer.from("hello").toString("hex");
      const node = createMockEncodingNode({
        operation: "decode",
        format: "hex",
        input,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("hello");
    });

    it("should decode null bytes from hex", async () => {
      const node = createMockEncodingNode({
        operation: "decode",
        format: "hex",
        input: "000102",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("\x00\x01\x02");
    });
  });

  describe("execute — decode operation (url)", () => {
    it("should decode URL component", async () => {
      const node = createMockEncodingNode({
        operation: "decode",
        format: "url",
        input: "hello%20world%20%26%20special",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("hello world & special");
    });

    it("should decode email from URL encoding", async () => {
      const node = createMockEncodingNode({
        operation: "decode",
        format: "url",
        input: "user%40example.com",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe("user@example.com");
    });
  });

  describe("execute — hash operation (sha256)", () => {
    it("should hash string with sha256", async () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "sha256",
        input: "password123",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toHaveLength(64); // SHA256 hex is 64 chars
      // Verify it's valid hex
      expect(/^[0-9a-f]{64}$/.test(result.output.result)).toBe(true);
    });

    it("should produce consistent hash", async () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "sha256",
        input: "test",
      });
      const ctx = createMockContext();

      const result1 = await encoding_handler.execute(node, ctx);
      const result2 = await encoding_handler.execute(node, ctx);

      expect(result1.output.result).toBe(result2.output.result);
    });

    it("should hash empty string", async () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "sha256",
        input: "",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toHaveLength(64);
    });
  });

  describe("execute — hash operation (sha512)", () => {
    it("should hash string with sha512", async () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "sha512",
        input: "password123",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toHaveLength(128); // SHA512 hex is 128 chars
      expect(/^[0-9a-f]{128}$/.test(result.output.result)).toBe(true);
    });
  });

  describe("execute — hash operation (md5)", () => {
    it("should hash string with md5", async () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "md5",
        input: "password123",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toHaveLength(32); // MD5 hex is 32 chars
      expect(/^[0-9a-f]{32}$/.test(result.output.result)).toBe(true);
    });
  });

  describe("execute — uuid operation", () => {
    it("should generate single UUID", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: 1,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result.output.result)).toBe(true);
    });

    it("should generate multiple UUIDs", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: 5,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const uuids = result.output.result.split("\n");
      expect(uuids).toHaveLength(5);
      uuids.forEach((uuid) => {
        expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)).toBe(true);
      });
    });

    it("should limit UUID generation to 100", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: 150,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const uuids = result.output.result.split("\n");
      expect(uuids).toHaveLength(100);
    });

    it("should generate unique UUIDs", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: 10,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const uuids = result.output.result.split("\n");
      const uniqueUuids = new Set(uuids);
      expect(uniqueUuids.size).toBe(10); // All should be unique
    });

    it("should handle count=0", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: 0,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Should generate at least 1 UUID (count is clamped to min 1)
      expect(result.output.result).toMatch(/^[0-9a-f]{8}-/);
    });

    it("should handle negative count", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: -5,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      // Should generate at least 1 UUID (count is clamped to min 1)
      expect(result.output.result).toMatch(/^[0-9a-f]{8}-/);
    });
  });

  describe("execute — template variable resolution", () => {
    it("should resolve input template", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "{{memory.text}}",
      });
      const ctx = createMockContext({
        memory: { text: "secret" },
      });

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(Buffer.from("secret").toString("base64"));
    });

    it("should use operation as-is (no template resolution)", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "data",
      });
      const ctx = createMockContext({
        memory: { op: "decode" },
      });

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(Buffer.from("data").toString("base64"));
    });

    it("should use format as-is (no template resolution)", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "test",
      });
      const ctx = createMockContext({
        memory: { fmt: "hex" },
      });

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(Buffer.from("test").toString("base64"));
    });
  });

  describe("execute — unsupported format", () => {
    it("should handle unsupported encode format", async () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "unsupported" as any,
        input: "data",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("Unsupported");
    });

    it("should handle unsupported decode format", async () => {
      const node = createMockEncodingNode({
        operation: "decode",
        format: "unsupported" as any,
        input: "data",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("Unsupported");
    });

    it("should handle unsupported hash format", async () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "blake3" as any,
        input: "data",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("Unsupported hash");
    });

    it("should handle unsupported operation", async () => {
      const node = createMockEncodingNode({
        operation: "compress" as any,
        format: "base64",
        input: "data",
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.result).toContain("Unsupported");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for encode with input", () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "data",
      });
      const ctx = createMockContext();

      const result = encoding_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when input missing for non-uuid", () => {
      const node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "",
      });
      const ctx = createMockContext();

      const result = encoding_handler.test(node, ctx);

      expect(result.warnings).toContain("input is required");
    });

    it("should not warn for uuid without input", () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        format: "",
        input: "",
      });
      const ctx = createMockContext();

      const result = encoding_handler.test(node, ctx);

      expect(result.warnings).not.toContain("input is required");
    });

    it("should include preview with operation and format", () => {
      const node = createMockEncodingNode({
        operation: "hash",
        format: "sha256",
        input: "data",
      });
      const ctx = createMockContext();

      const result = encoding_handler.test(node, ctx);

      expect(result.preview.operation).toBe("hash");
      expect(result.preview.format).toBe("sha256");
    });
  });

  describe("integration scenarios", () => {
    it("should encode data then hash it", async () => {
      // Encode to base64
      let node = createMockEncodingNode({
        operation: "encode",
        format: "base64",
        input: "sensitive data",
      });
      let ctx = createMockContext();

      let result = await encoding_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      const encoded = result.output.result;

      // Hash the encoded data
      node = createMockEncodingNode({
        operation: "hash",
        format: "sha256",
        input: encoded,
      });

      result = await encoding_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      expect(result.output.result).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate UUIDs for multiple resources", async () => {
      const node = createMockEncodingNode({
        operation: "uuid",
        count: 3,
      });
      const ctx = createMockContext();

      const result = await encoding_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const uuids = result.output.result.split("\n");
      expect(uuids).toHaveLength(3);
      const uniqueSet = new Set(uuids);
      expect(uniqueSet.size).toBe(3);
    });

    it("should handle URL encoding/decoding cycle", async () => {
      const originalUrl = "hello world & special/chars?key=value";

      // Encode
      let node = createMockEncodingNode({
        operation: "encode",
        format: "url",
        input: originalUrl,
      });
      let ctx = createMockContext();

      let result = await encoding_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      const encoded = result.output.result;

      // Decode
      node = createMockEncodingNode({
        operation: "decode",
        format: "url",
        input: encoded,
      });

      result = await encoding_handler.execute(node, ctx);
      expect(result.output.success).toBe(true);
      expect(result.output.result).toBe(originalUrl);
    });

    it("should hash different algorithms produce different results", async () => {
      const input = "test data";

      let node = createMockEncodingNode({
        operation: "hash",
        format: "md5",
        input,
      });
      let ctx = createMockContext();

      let result1 = await encoding_handler.execute(node, ctx);
      expect(result1.output.success).toBe(true);

      node = createMockEncodingNode({
        operation: "hash",
        format: "sha256",
        input,
      });

      let result2 = await encoding_handler.execute(node, ctx);
      expect(result2.output.success).toBe(true);

      // Different algorithms produce different hashes
      expect(result1.output.result).not.toBe(result2.output.result);
      // Different lengths: MD5=32, SHA256=64
      expect(result1.output.result.length).toBe(32);
      expect(result2.output.result.length).toBe(64);
    });
  });
});
