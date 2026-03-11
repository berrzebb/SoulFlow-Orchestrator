/**
 * rss.ts — 미커버 분기 보충:
 * - L135: item.pubDate 있음 → <pubDate> 태그 추가
 * - L136: item.guid 있음 → <guid> 태그 추가
 */
import { describe, it, expect } from "vitest";
import { RssTool } from "@src/agent/tools/rss.js";

const rss = new RssTool();

describe("RssTool — L135/L136: pubDate + guid → XML에 포함", () => {
  it("generate — pubDate + guid 있는 item → <pubDate>, <guid> 포함 (L135, L136)", async () => {
    const result = await rss.execute({
      action: "generate",
      title: "My Feed",
      link: "https://example.com",
      items: JSON.stringify([{
        title: "Post 1",
        link: "https://example.com/1",
        description: "First post",
        pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
        guid: "https://example.com/guid/1",
      }]),
    });
    expect(result).toContain("<pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>");
    expect(result).toContain("<guid>https://example.com/guid/1</guid>");
  });
});
