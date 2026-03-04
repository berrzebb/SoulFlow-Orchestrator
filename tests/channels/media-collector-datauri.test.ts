import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaCollector } from "@src/channels/media-collector.ts";
import type { InboundMessage } from "@src/bus/types.ts";

function make_message(media: Array<{ type: string; url: string; name?: string }>): InboundMessage {
  return {
    id: "test-msg-1",
    provider: "web",
    channel: "web",
    sender_id: "web_user",
    chat_id: "web_test",
    content: "테스트",
    at: new Date().toISOString(),
    media: media as InboundMessage["media"],
  };
}

/** 1x1 red PNG (base64). */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_URI = `data:image/png;base64,${TINY_PNG_B64}`;

describe("MediaCollector — data URI 처리", () => {
  let workspace: string;
  let collector: MediaCollector;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "mc-test-"));
    collector = new MediaCollector({ workspace_dir: workspace, tokens: {} });
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("data URI 이미지를 디코딩하여 로컬 파일로 저장한다", async () => {
    const msg = make_message([{ type: "image", url: TINY_PNG_URI, name: "screenshot.png" }]);
    const paths = await collector.collect("web", msg);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("screenshot.png");

    const bytes = await readFile(paths[0]);
    expect(bytes[0]).toBe(0x89); // PNG magic byte
    expect(bytes[1]).toBe(0x50); // 'P'
  });

  it("hint name이 없으면 MIME 기반 확장자를 사용한다", async () => {
    const msg = make_message([{ type: "image", url: TINY_PNG_URI }]);
    const paths = await collector.collect("web", msg);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/\.png$/);
  });

  it("잘못된 data URI는 무시한다", async () => {
    const msg = make_message([{ type: "file", url: "data:invalid" }]);
    const paths = await collector.collect("web", msg);
    expect(paths).toHaveLength(0);
  });

  it("빈 base64 payload는 무시한다", async () => {
    const msg = make_message([{ type: "file", url: "data:image/png;base64," }]);
    const paths = await collector.collect("web", msg);
    expect(paths).toHaveLength(0);
  });

  it("PDF data URI도 저장한다", async () => {
    const pdf_b64 = Buffer.from("%PDF-1.4 test").toString("base64");
    const msg = make_message([{ type: "file", url: `data:application/pdf;base64,${pdf_b64}`, name: "doc.pdf" }]);
    const paths = await collector.collect("web", msg);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("doc.pdf");

    const content = await readFile(paths[0], "utf-8");
    expect(content).toContain("%PDF");
  });

  it("여러 미디어를 동시에 처리한다", async () => {
    const txt_b64 = Buffer.from("hello world").toString("base64");
    const msg = make_message([
      { type: "image", url: TINY_PNG_URI, name: "a.png" },
      { type: "file", url: `data:text/plain;base64,${txt_b64}`, name: "b.txt" },
    ]);
    const paths = await collector.collect("web", msg);
    expect(paths).toHaveLength(2);
  });
});
