/**
 * media-utils.ts 커버리지.
 * detect_media_type, to_local_media_item 테스트.
 */
import { describe, it, expect } from "vitest";
import { detect_media_type, to_local_media_item } from "@src/agent/tools/media-utils.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("detect_media_type", () => {
  it("png → image", () => expect(detect_media_type("photo.png")).toBe("image"));
  it("jpg → image", () => expect(detect_media_type("photo.jpg")).toBe("image"));
  it("gif → image", () => expect(detect_media_type("anim.gif")).toBe("image"));
  it("webp → image", () => expect(detect_media_type("img.webp")).toBe("image"));
  it("svg → image", () => expect(detect_media_type("icon.svg")).toBe("image"));
  it("mp4 → video", () => expect(detect_media_type("clip.mp4")).toBe("video"));
  it("mov → video", () => expect(detect_media_type("clip.mov")).toBe("video"));
  it("webm → video", () => expect(detect_media_type("clip.webm")).toBe("video"));
  it("avi → video", () => expect(detect_media_type("clip.avi")).toBe("video"));
  it("mp3 → audio", () => expect(detect_media_type("track.mp3")).toBe("audio"));
  it("wav → audio", () => expect(detect_media_type("sound.wav")).toBe("audio"));
  it("ogg → audio", () => expect(detect_media_type("sound.ogg")).toBe("audio"));
  it("m4a → audio", () => expect(detect_media_type("sound.m4a")).toBe("audio"));
  it("pdf → file", () => expect(detect_media_type("doc.pdf")).toBe("file"));
  it("txt → file", () => expect(detect_media_type("note.txt")).toBe("file"));
  it("zip → file", () => expect(detect_media_type("archive.zip")).toBe("file"));
  it("확장자 없음 → file", () => expect(detect_media_type("noext")).toBe("file"));
  it("빈 문자열 → file", () => expect(detect_media_type("")).toBe("file"));
  it("알 수 없는 확장자 → file", () => expect(detect_media_type("file.xyz")).toBe("file"));
  it("대문자 확장자 → image", () => expect(detect_media_type("PHOTO.PNG")).toBe("image"));
});

describe("to_local_media_item", () => {
  it("빈 문자열 → null", () => {
    expect(to_local_media_item("", "/workspace")).toBeNull();
  });

  it("URL http:// → null (local ref 아님)", () => {
    expect(to_local_media_item("http://example.com/img.png", "/workspace")).toBeNull();
  });

  it("존재하지 않는 local 경로 → null", () => {
    expect(to_local_media_item("./nonexistent-file-xyz.png", "/tmp")).toBeNull();
  });
});
