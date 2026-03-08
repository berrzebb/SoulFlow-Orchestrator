/**
 * CompressTool 커버리지 — gzip/brotli 문자열 압축·해제 + 파일 작업 에러 케이스.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompressTool } from "@src/agent/tools/compress.js";

const tool = new CompressTool();

describe("CompressTool — 메타데이터", () => {
  it("name = compress", () => expect(tool.name).toBe("compress"));
  it("category = filesystem", () => expect(tool.category).toBe("filesystem"));
  it("to_schema: function 형식", () => expect(tool.to_schema().type).toBe("function"));
});

describe("CompressTool — compress_string (gzip)", () => {
  it("문자열 → base64 gzip 압축", async () => {
    const result = await tool.execute({ operation: "compress_string", input: "hello world", algorithm: "gzip" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // base64 유효성 확인
    expect(() => Buffer.from(result, "base64")).not.toThrow();
  });

  it("input 없음 → Error 반환", async () => {
    const result = await tool.execute({ operation: "compress_string", input: "" });
    expect(result).toContain("Error");
    expect(result).toContain("input");
  });

  it("기본 알고리즘 = gzip", async () => {
    const result = await tool.execute({ operation: "compress_string", input: "test" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("level 파라미터 적용", async () => {
    const result = await tool.execute({ operation: "compress_string", input: "level test", algorithm: "gzip", level: 1 });
    expect(typeof result).toBe("string");
  });
});

describe("CompressTool — compress_string (brotli)", () => {
  it("brotli 압축", async () => {
    const result = await tool.execute({ operation: "compress_string", input: "hello brotli", algorithm: "brotli" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("brotli level 파라미터", async () => {
    const result = await tool.execute({ operation: "compress_string", input: "brotli level", algorithm: "brotli", level: 2 });
    expect(typeof result).toBe("string");
  });
});

describe("CompressTool — decompress_string (gzip)", () => {
  it("압축 후 해제 → 원본 복원", async () => {
    const original = "hello world, this is a test string!";
    const compressed = await tool.execute({ operation: "compress_string", input: original, algorithm: "gzip" });
    const decompressed = await tool.execute({ operation: "decompress_string", input: compressed, algorithm: "gzip" });
    expect(decompressed).toBe(original);
  });

  it("input 없음 → Error 반환", async () => {
    const result = await tool.execute({ operation: "decompress_string", input: "" });
    expect(result).toContain("Error");
  });

  it("기본 알고리즘 = gzip", async () => {
    const compressed = await tool.execute({ operation: "compress_string", input: "roundtrip" });
    const decompressed = await tool.execute({ operation: "decompress_string", input: compressed });
    expect(decompressed).toBe("roundtrip");
  });
});

describe("CompressTool — decompress_string (brotli)", () => {
  it("brotli 압축 후 해제 → 원본 복원", async () => {
    const original = "brotli roundtrip test";
    const compressed = await tool.execute({ operation: "compress_string", input: original, algorithm: "brotli" });
    const decompressed = await tool.execute({ operation: "decompress_string", input: compressed, algorithm: "brotli" });
    expect(decompressed).toBe(original);
  });
});

describe("CompressTool — 파일 압축 (compress)", () => {
  let tmpdir_path: string;

  it("gzip 파일 압축", async () => {
    tmpdir_path = mkdtempSync(join(tmpdir(), "compress-test-"));
    const input_file = join(tmpdir_path, "test.txt");
    const output_file = join(tmpdir_path, "test.txt.gz");
    writeFileSync(input_file, "file content to compress");

    const result = await tool.execute({ operation: "compress", input_path: input_file, output_path: output_file, algorithm: "gzip" });
    const parsed = JSON.parse(result);
    expect(parsed.input).toBe(input_file);
    expect(parsed.output).toBe(output_file);
    expect(parsed.algorithm).toBe("gzip");
    expect(existsSync(output_file)).toBe(true);

    rmSync(tmpdir_path, { recursive: true, force: true });
  });

  it("brotli 파일 압축", async () => {
    tmpdir_path = mkdtempSync(join(tmpdir(), "compress-test-"));
    const input_file = join(tmpdir_path, "test.txt");
    const output_file = join(tmpdir_path, "test.txt.br");
    writeFileSync(input_file, "brotli file content");

    const result = await tool.execute({ operation: "compress", input_path: input_file, output_path: output_file, algorithm: "brotli" });
    const parsed = JSON.parse(result);
    expect(parsed.algorithm).toBe("brotli");
    expect(existsSync(output_file)).toBe(true);

    rmSync(tmpdir_path, { recursive: true, force: true });
  });

  it("input_path 없음 → Error", async () => {
    const result = await tool.execute({ operation: "compress", input_path: "" });
    expect(result).toContain("Error");
    expect(result).toContain("input_path");
  });

  it("존재하지 않는 파일 → Error", async () => {
    const result = await tool.execute({ operation: "compress", input_path: "/nonexistent/path/file.txt" });
    expect(result).toContain("Error");
  });

  it("자동 output_path (gzip)", async () => {
    tmpdir_path = mkdtempSync(join(tmpdir(), "compress-test-"));
    const input_file = join(tmpdir_path, "auto.txt");
    writeFileSync(input_file, "auto output path test");

    const result = await tool.execute({ operation: "compress", input_path: input_file, algorithm: "gzip" });
    const parsed = JSON.parse(result);
    expect(parsed.output).toBe(`${input_file}.gz`);

    rmSync(tmpdir_path, { recursive: true, force: true });
  });

  it("자동 output_path (brotli)", async () => {
    tmpdir_path = mkdtempSync(join(tmpdir(), "compress-test-"));
    const input_file = join(tmpdir_path, "auto.txt");
    writeFileSync(input_file, "brotli auto path");

    const result = await tool.execute({ operation: "compress", input_path: input_file, algorithm: "brotli" });
    const parsed = JSON.parse(result);
    expect(parsed.output).toBe(`${input_file}.br`);

    rmSync(tmpdir_path, { recursive: true, force: true });
  });
});

describe("CompressTool — 파일 해제 (decompress)", () => {
  it("gzip 파일 해제", async () => {
    const tmpdir_path = mkdtempSync(join(tmpdir(), "decomp-test-"));
    const input_file = join(tmpdir_path, "test.txt");
    const gz_file = join(tmpdir_path, "test.txt.gz");
    writeFileSync(input_file, "decompress me");

    await tool.execute({ operation: "compress", input_path: input_file, output_path: gz_file, algorithm: "gzip" });
    const output_file = join(tmpdir_path, "output.txt");
    const result = await tool.execute({ operation: "decompress", input_path: gz_file, output_path: output_file, algorithm: "gzip" });
    const parsed = JSON.parse(result);
    expect(parsed.decompressed_size).toBeGreaterThan(0);
    expect(existsSync(output_file)).toBe(true);

    rmSync(tmpdir_path, { recursive: true, force: true });
  });

  it("brotli 파일 해제", async () => {
    const tmpdir_path = mkdtempSync(join(tmpdir(), "decomp-br-test-"));
    const input_file = join(tmpdir_path, "test.txt");
    const br_file = join(tmpdir_path, "test.txt.br");
    writeFileSync(input_file, "brotli decompress me");

    await tool.execute({ operation: "compress", input_path: input_file, output_path: br_file, algorithm: "brotli" });
    const output_file = join(tmpdir_path, "output.txt");
    const result = await tool.execute({ operation: "decompress", input_path: br_file, output_path: output_file, algorithm: "brotli" });
    const parsed = JSON.parse(result);
    expect(parsed.decompressed_size).toBeGreaterThan(0);

    rmSync(tmpdir_path, { recursive: true, force: true });
  });

  it("input_path 없음 → Error", async () => {
    const result = await tool.execute({ operation: "decompress", input_path: "" });
    expect(result).toContain("Error");
    expect(result).toContain("input_path");
  });

  it("자동 output_path (확장자 제거)", async () => {
    const tmpdir_path = mkdtempSync(join(tmpdir(), "decomp-auto-"));
    const input_file = join(tmpdir_path, "data.txt");
    const gz_file = join(tmpdir_path, "data.txt.gz");
    writeFileSync(input_file, "auto decompress path");

    await tool.execute({ operation: "compress", input_path: input_file, output_path: gz_file, algorithm: "gzip" });
    const result = await tool.execute({ operation: "decompress", input_path: gz_file, algorithm: "gzip" });
    const parsed = JSON.parse(result);
    expect(parsed.output).toBe(input_file); // .gz 제거

    rmSync(tmpdir_path, { recursive: true, force: true });
  });
});

describe("CompressTool — 알 수 없는 operation", () => {
  it("미지원 operation → Error 반환", async () => {
    const result = await tool.execute({ operation: "unknown_op" });
    expect(result).toContain("Error");
    expect(result).toContain("unknown_op");
  });
});
