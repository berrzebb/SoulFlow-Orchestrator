/**
 * VectorStoreTool + ImageTool 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { VectorStoreTool } from "@src/agent/tools/vector-store.js";
import { ImageTool } from "@src/agent/tools/image.js";

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// VectorStoreTool
// ══════════════════════════════════════════

function make_vs() {
  return new VectorStoreTool();
}

describe("VectorStoreTool — 메타데이터", () => {
  it("name = vector_store", () => expect(make_vs().name).toBe("vector_store"));
  it("category = ai", () => expect(make_vs().category).toBe("ai"));
  it("policy_flags: write=true", () => expect(make_vs().policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_vs().to_schema().type).toBe("function"));
});

describe("VectorStoreTool — create_collection", () => {
  it("컬렉션 생성 성공", async () => {
    const tool = make_vs();
    const r = await tool.execute({ action: "create_collection", collection: "docs", dimensions: 3 });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.dimensions).toBe(3);
  });

  it("collection 없음 → Error", async () => {
    const r = await make_vs().execute({ action: "create_collection", dimensions: 3 });
    expect(r).toContain("Error");
    expect(r).toContain("collection");
  });

  it("dimensions < 1 → Error", async () => {
    const r = await make_vs().execute({ action: "create_collection", collection: "docs", dimensions: 0 });
    expect(r).toContain("Error");
    expect(r).toContain("dimensions");
  });

  it("중복 컬렉션 → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "docs", dimensions: 3 });
    const r = await tool.execute({ action: "create_collection", collection: "docs", dimensions: 3 });
    expect(r).toContain("Error");
    expect(r).toContain("already exists");
  });
});

describe("VectorStoreTool — insert", () => {
  it("벡터 삽입 성공 → ok=true", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 2 });
    const r = await tool.execute({ action: "insert", collection: "test", id: "v1", vector: "[0.1, 0.2]" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.id).toBe("v1");
  });

  it("컬렉션 없음 → Error", async () => {
    const r = await make_vs().execute({ action: "insert", collection: "ghost", vector: "[1,0]" });
    expect(r).toContain("Error");
    expect(r).toContain("not found");
  });

  it("잘못된 vector JSON → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 2 });
    const r = await tool.execute({ action: "insert", collection: "test", vector: "not json" });
    expect(r).toContain("Error");
    expect(r).toContain("JSON");
  });

  it("차원 불일치 → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 3 });
    const r = await tool.execute({ action: "insert", collection: "test", vector: "[1, 0]" }); // 2D, expect 3D
    expect(r).toContain("Error");
    expect(r).toContain("dimensions");
  });

  it("잘못된 metadata JSON → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 2 });
    const r = await tool.execute({ action: "insert", collection: "test", vector: "[0,1]", metadata: "bad{json" });
    expect(r).toContain("Error");
    expect(r).toContain("metadata");
  });

  it("id 없음 → 자동 생성", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    const r = await tool.execute({ action: "insert", collection: "test", vector: "[0.5]" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.id).toBeTruthy();
  });
});

describe("VectorStoreTool — query", () => {
  it("유사 벡터 검색 성공", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 2 });
    await tool.execute({ action: "insert", collection: "test", id: "v1", vector: "[1, 0]" });
    await tool.execute({ action: "insert", collection: "test", id: "v2", vector: "[0, 1]" });

    const r = await tool.execute({ action: "query", collection: "test", vector: "[1, 0]", top_k: 1 });
    const parsed = JSON.parse(r);
    expect(parsed.results[0].id).toBe("v1");
    expect(parsed.results[0].score).toBeCloseTo(1.0, 5);
  });

  it("잘못된 vector → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 2 });
    const r = await tool.execute({ action: "query", collection: "test", vector: "invalid" });
    expect(r).toContain("Error");
  });

  it("차원 불일치 → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 3 });
    const r = await tool.execute({ action: "query", collection: "test", vector: "[1, 0]" });
    expect(r).toContain("Error");
    expect(r).toContain("dimensions");
  });

  it("filter 적용 → 조건 맞는 항목만 반환", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    await tool.execute({ action: "insert", collection: "test", id: "doc", vector: "[0.9]", metadata: JSON.stringify({ type: "doc" }) });
    await tool.execute({ action: "insert", collection: "test", id: "img", vector: "[0.8]", metadata: JSON.stringify({ type: "img" }) });

    const r = await tool.execute({ action: "query", collection: "test", vector: "[1.0]", filter: JSON.stringify({ type: "doc" }) });
    const parsed = JSON.parse(r);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe("doc");
  });

  it("잘못된 filter → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    const r = await tool.execute({ action: "query", collection: "test", vector: "[0.5]", filter: "bad json{" });
    expect(r).toContain("Error");
    expect(r).toContain("filter");
  });
});

describe("VectorStoreTool — delete", () => {
  it("삭제 성공", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    await tool.execute({ action: "insert", collection: "test", id: "v1", vector: "[0.5]" });
    const r = await tool.execute({ action: "delete", collection: "test", id: "v1" });
    const parsed = JSON.parse(r);
    expect(parsed.ok).toBe(true);
    expect(parsed.deleted).toBe("v1");
  });

  it("id 없음 → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    const r = await tool.execute({ action: "delete", collection: "test" });
    expect(r).toContain("Error");
    expect(r).toContain("id");
  });

  it("없는 id → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    const r = await tool.execute({ action: "delete", collection: "test", id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("not found");
  });
});

describe("VectorStoreTool — get", () => {
  it("항목 조회 성공", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 2 });
    await tool.execute({ action: "insert", collection: "test", id: "my-vec", vector: "[0.5, 0.5]", metadata: JSON.stringify({ tag: "x" }) });
    const r = await tool.execute({ action: "get", collection: "test", id: "my-vec" });
    const parsed = JSON.parse(r);
    expect(parsed.id).toBe("my-vec");
    expect(parsed.vector).toHaveLength(2);
    expect(parsed.metadata.tag).toBe("x");
  });

  it("없는 id → Error", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    const r = await tool.execute({ action: "get", collection: "test", id: "ghost" });
    expect(r).toContain("Error");
    expect(r).toContain("not found");
  });
});

describe("VectorStoreTool — count", () => {
  it("컬렉션 항목 수 반환", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "test", dimensions: 1 });
    await tool.execute({ action: "insert", collection: "test", id: "v1", vector: "[0.1]" });
    await tool.execute({ action: "insert", collection: "test", id: "v2", vector: "[0.2]" });
    const r = await tool.execute({ action: "count", collection: "test" });
    const parsed = JSON.parse(r);
    expect(parsed.count).toBe(2);
  });
});

describe("VectorStoreTool — list_collections", () => {
  it("컬렉션 목록 반환", async () => {
    const tool = make_vs();
    await tool.execute({ action: "create_collection", collection: "col1", dimensions: 3 });
    await tool.execute({ action: "create_collection", collection: "col2", dimensions: 5 });
    const r = await tool.execute({ action: "list_collections" });
    const parsed = JSON.parse(r);
    expect(parsed.length).toBe(2);
    expect(parsed.some((c: Record<string, unknown>) => c["name"] === "col1")).toBe(true);
  });
});

describe("VectorStoreTool — 알 수 없는 action", () => {
  it("unsupported action → Error 반환", async () => {
    const r = await make_vs().execute({ action: "truncate" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

// ══════════════════════════════════════════
// ImageTool
// ══════════════════════════════════════════

vi.mock("@src/agent/tools/shell-runtime.js", () => ({
  run_shell_command: vi.fn(),
}));

import * as shell_runtime from "@src/agent/tools/shell-runtime.js";
const mock_shell = shell_runtime.run_shell_command as ReturnType<typeof vi.fn>;

function make_image() {
  return new ImageTool({ workspace: "/tmp" });
}

describe("ImageTool — 메타데이터", () => {
  it("name = image", () => expect(make_image().name).toBe("image"));
  it("category = filesystem", () => expect(make_image().category).toBe("filesystem"));
  it("policy_flags: write=true", () => expect(make_image().policy_flags.write).toBe(true));
  it("to_schema: function 형식", () => expect(make_image().to_schema().type).toBe("function"));
});

describe("ImageTool — 유효성 검사", () => {
  it("input_path 없음 → Error", async () => {
    const r = await make_image().execute({ operation: "info", input_path: "" });
    expect(r).toContain("Error");
    expect(r).toContain("input_path");
  });

  it("unsupported operation → Error", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "blur", input_path: "/tmp/img.png" });
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });
});

describe("ImageTool — info", () => {
  it("identify 실행 → 결과 반환", async () => {
    mock_shell.mockResolvedValue({ stdout: "Format: PNG\nGeometry: 100x100", stderr: "" });
    const r = await make_image().execute({ operation: "info", input_path: "/tmp/img.png" });
    expect(r).toContain("PNG");
  });

  it("shell 빈 출력 → fallback 메시지", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "info", input_path: "/tmp/img.png" });
    expect(r).toContain("ImageMagick");
  });
});

describe("ImageTool — resize", () => {
  it("width/height 없음 → Error", async () => {
    const r = await make_image().execute({ operation: "resize", input_path: "/tmp/img.png" });
    expect(r).toContain("Error");
    expect(r).toContain("width or height");
  });

  it("width만 → 리사이즈 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "resize", input_path: "/tmp/img.png", width: 800, output_path: "/tmp/out.png" });
    expect(r).toContain("Resized");
    expect(r).toContain("800x");
  });

  it("height만 → 리사이즈 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "resize", input_path: "/tmp/img.png", height: 600 });
    expect(r).toContain("x600");
  });

  it("width + height → 리사이즈 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "resize", input_path: "/tmp/img.png", width: 800, height: 600 });
    expect(r).toContain("800x600");
  });
});

describe("ImageTool — crop", () => {
  it("width/height 없음 → Error", async () => {
    const r = await make_image().execute({ operation: "crop", input_path: "/tmp/img.png" });
    expect(r).toContain("Error");
    expect(r).toContain("width and height");
  });

  it("crop 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "crop", input_path: "/tmp/img.png", width: 200, height: 200, gravity: "center" });
    expect(r).toContain("Cropped");
    expect(r).toContain("200x200");
    expect(r).toContain("center");
  });
});

describe("ImageTool — rotate", () => {
  it("rotate 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "rotate", input_path: "/tmp/img.png", angle: 90 });
    expect(r).toContain("Rotated");
    expect(r).toContain("90°");
  });
});

describe("ImageTool — convert", () => {
  it("format 변환 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({
      operation: "convert",
      input_path: "/tmp/img.png",
      output_path: "/tmp/out.jpg",
      format: "jpeg",
      quality: 90,
    });
    expect(r).toContain("Converted");
    expect(r).toContain("jpeg");
    expect(r).toContain("quality: 90");
  });
});

describe("ImageTool — thumbnail", () => {
  it("썸네일 생성 성공", async () => {
    mock_shell.mockResolvedValue({ stdout: "", stderr: "" });
    const r = await make_image().execute({ operation: "thumbnail", input_path: "/tmp/img.png", width: 150 });
    expect(r).toContain("Thumbnail");
    expect(r).toContain("150x150");
  });
});

describe("ImageTool — 예외 처리", () => {
  it("shell 명령 예외 → Error 반환", async () => {
    mock_shell.mockRejectedValue(new Error("ImageMagick not found"));
    const r = await make_image().execute({ operation: "info", input_path: "/tmp/img.png" });
    expect(r).toContain("Error");
    expect(r).toContain("ImageMagick not found");
  });
});
