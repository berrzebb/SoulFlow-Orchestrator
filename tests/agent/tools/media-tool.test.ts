/**
 * MediaTool — fs/promises mock 기반 커버리지.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mock_read_file, mock_write_file, mock_stat } = vi.hoisted(() => ({
  mock_read_file: vi.fn(),
  mock_write_file: vi.fn().mockResolvedValue(undefined),
  mock_stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mock_read_file,
  writeFile: mock_write_file,
  stat: mock_stat,
}));

import { MediaTool } from "@src/agent/tools/media.js";

const WS = "/tmp/workspace";
function make_tool() { return new MediaTool({ workspace: WS }); }

function make_stat(size = 1024) {
  return {
    size,
    birthtime: new Date("2024-01-01"),
    mtime: new Date("2024-06-01"),
  };
}

beforeEach(() => { vi.clearAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("MediaTool — 메타데이터", () => {
  it("name = media", () => expect(make_tool().name).toBe("media"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// detect_type
// ══════════════════════════════════════════

describe("MediaTool — detect_type", () => {
  it("path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "detect_type", path: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("path");
  });

  it("path traversal → Error", async () => {
    await expect(make_tool().execute({ action: "detect_type", path: "../../etc/passwd" })).rejects.toThrow("path traversal");
  });

  it(".jpg → image/jpeg", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "detect_type", path: "photo.jpg" }));
    expect(r.mime).toBe("image/jpeg");
    expect(r.category).toBe("image");
  });

  it(".mp3 → audio/mpeg", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "detect_type", path: "music.mp3" }));
    expect(r.mime).toBe("audio/mpeg");
    expect(r.category).toBe("audio");
  });

  it(".mp4 → video/mp4", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "detect_type", path: "clip.mp4" }));
    expect(r.mime).toBe("video/mp4");
    expect(r.category).toBe("video");
  });

  it(".pdf → document", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "detect_type", path: "doc.pdf" }));
    expect(r.category).toBe("document");
  });

  it(".json → document", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "detect_type", path: "data.json" }));
    expect(r.category).toBe("document");
  });

  it("미지원 확장자 → application/octet-stream", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "detect_type", path: "file.unknown123" }));
    expect(r.mime).toBe("application/octet-stream");
    expect(r.category).toBe("unknown");
  });
});

// ══════════════════════════════════════════
// metadata
// ══════════════════════════════════════════

describe("MediaTool — metadata", () => {
  it("path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "metadata", path: "" });
    expect(String(r)).toContain("Error");
  });

  it("성공 → name/ext/mime/size 반환", async () => {
    mock_stat.mockResolvedValueOnce(make_stat(2048));
    const r = JSON.parse(await make_tool().execute({ action: "metadata", path: "image.png" }));
    expect(r.name).toBe("image.png");
    expect(r.ext).toBe(".png");
    expect(r.mime).toBe("image/png");
    expect(r.size_bytes).toBe(2048);
    expect(r.size_human).toContain("KB");
  });

  it("크기 포맷: B < 1KB", async () => {
    mock_stat.mockResolvedValueOnce(make_stat(512));
    const r = JSON.parse(await make_tool().execute({ action: "metadata", path: "small.bin" }));
    expect(r.size_human).toContain("B");
  });

  it("크기 포맷: MB", async () => {
    mock_stat.mockResolvedValueOnce(make_stat(5 * 1024 * 1024));
    const r = JSON.parse(await make_tool().execute({ action: "metadata", path: "large.mp4" }));
    expect(r.size_human).toContain("MB");
  });

  it("크기 포맷: GB", async () => {
    mock_stat.mockResolvedValueOnce(make_stat(2 * 1024 * 1024 * 1024));
    const r = JSON.parse(await make_tool().execute({ action: "metadata", path: "huge.mkv" }));
    expect(r.size_human).toContain("GB");
  });
});

// ══════════════════════════════════════════
// to_base64
// ══════════════════════════════════════════

describe("MediaTool — to_base64", () => {
  it("path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "to_base64", path: "" });
    expect(String(r)).toContain("Error");
  });

  it("성공 → data_uri + mime + size", async () => {
    mock_read_file.mockResolvedValueOnce(Buffer.from("PNG data"));
    const r = JSON.parse(await make_tool().execute({ action: "to_base64", path: "image.png" }));
    expect(r.data_uri).toMatch(/^data:image\/png;base64,/);
    expect(r.mime).toBe("image/png");
    expect(r.size).toBe(8);
  });
});

// ══════════════════════════════════════════
// from_base64
// ══════════════════════════════════════════

describe("MediaTool — from_base64", () => {
  it("data 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "from_base64", data: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("data");
  });

  it("data URI 형식 → 콤마 이후 base64 추출", async () => {
    mock_write_file.mockResolvedValueOnce(undefined);
    const b64 = Buffer.from("hello").toString("base64");
    const r = JSON.parse(await make_tool().execute({
      action: "from_base64",
      data: `data:text/plain;base64,${b64}`,
      output_path: "output.txt",
    }));
    expect(r.size).toBe(5);
    expect(mock_write_file).toHaveBeenCalledOnce();
  });

  it("순수 base64 (콤마 없음)", async () => {
    mock_write_file.mockResolvedValueOnce(undefined);
    const b64 = Buffer.from("world").toString("base64");
    const r = JSON.parse(await make_tool().execute({
      action: "from_base64",
      data: b64,
      output_path: "output.bin",
    }));
    expect(r.size).toBe(5);
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("MediaTool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await make_tool().execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
