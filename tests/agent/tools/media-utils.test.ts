/**
 * media-utils — detect_media_type / to_local_media_item 테스트.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { detect_media_type, to_local_media_item } from "../../../src/agent/tools/media-utils.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workspace: string;
beforeAll(() => {
  workspace = join(tmpdir(), `media-utils-test-${Date.now()}`);
  mkdirSync(workspace, { recursive: true });
});

// ── detect_media_type ──────────────────────────────────────────────

describe("detect_media_type — image", () => {
  it.each([
    ["/tmp/photo.png", "image"],
    ["/tmp/photo.jpg", "image"],
    ["/tmp/photo.jpeg", "image"],
    ["/tmp/anim.gif", "image"],
    ["/tmp/pic.webp", "image"],
    ["/tmp/icon.svg", "image"],
  ])("%s → %s", (path, expected) => {
    expect(detect_media_type(path)).toBe(expected);
  });

  it("대문자 확장자도 image (PNG)", () => {
    expect(detect_media_type("/tmp/photo.PNG")).toBe("image");
  });
});

describe("detect_media_type — video", () => {
  it.each([
    ["/tmp/clip.mp4", "video"],
    ["/tmp/clip.mov", "video"],
    ["/tmp/clip.webm", "video"],
    ["/tmp/clip.mkv", "video"],
    ["/tmp/clip.avi", "video"],
  ])("%s → %s", (path, expected) => {
    expect(detect_media_type(path)).toBe(expected);
  });
});

describe("detect_media_type — audio", () => {
  it.each([
    ["/tmp/song.mp3", "audio"],
    ["/tmp/sound.wav", "audio"],
    ["/tmp/sound.ogg", "audio"],
    ["/tmp/sound.m4a", "audio"],
  ])("%s → %s", (path, expected) => {
    expect(detect_media_type(path)).toBe(expected);
  });
});

describe("detect_media_type — file (기타)", () => {
  it.each([
    ["/tmp/doc.pdf", "file"],
    ["/tmp/readme.txt", "file"],
    ["/tmp/data.json", "file"],
    ["/tmp/archive.zip", "file"],
    ["/tmp/archive.tar", "file"],
    ["/tmp/file.csv", "file"],
    ["/tmp/file.md", "file"],
  ])("%s → %s", (path, expected) => {
    expect(detect_media_type(path)).toBe(expected);
  });

  it("확장자 없음 → file", () => {
    expect(detect_media_type("/tmp/noext")).toBe("file");
  });

  it("빈 문자열 → file", () => {
    expect(detect_media_type("")).toBe("file");
  });
});

// ── to_local_media_item ──────────────────────────────────────────

describe("to_local_media_item — 정상 케이스", () => {
  it("실제 png 파일 → image MediaItem 반환", () => {
    const file = join(workspace, "photo.png");
    writeFileSync(file, "fake-png-data");
    const result = to_local_media_item(file, workspace);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("image");
    expect(result!.name).toBe("photo.png");
    expect(result!.url).toBe(file);
  });

  it("실제 txt 파일 → file MediaItem 반환", () => {
    const file = join(workspace, "readme.txt");
    writeFileSync(file, "text content");
    const result = to_local_media_item(file, workspace);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("file");
  });
});

describe("to_local_media_item — null 반환 케이스", () => {
  it("존재하지 않는 경로 → null", () => {
    expect(to_local_media_item(join(workspace, "nonexistent.png"), workspace)).toBeNull();
  });

  it("http URL → null (로컬 레퍼런스 아님)", () => {
    expect(to_local_media_item("https://example.com/image.png", workspace)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(to_local_media_item("", workspace)).toBeNull();
  });

  it("디렉토리 경로 → null (파일이 아님)", () => {
    const subdir = join(workspace, "subdir");
    mkdirSync(subdir, { recursive: true });
    // to_local_media_item은 디렉토리 → null 반환
    const result = to_local_media_item(subdir, workspace);
    expect(result).toBeNull();
  });
});
