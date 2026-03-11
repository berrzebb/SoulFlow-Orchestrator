/** RSS 도구 — RSS/Atom 피드 파싱/생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";

type FeedItem = { title: string; link: string; description?: string; pubDate?: string; guid?: string; author?: string };

export class RssTool extends Tool {
  readonly name = "rss";
  readonly category = "data" as const;
  readonly description = "RSS/Atom feed utilities: parse, generate, add_item, fetch_parse.";
  readonly policy_flags = { network: true };
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "generate", "add_item", "fetch_parse"], description: "RSS operation" },
      input: { type: "string", description: "RSS/Atom XML string" },
      url: { type: "string", description: "Feed URL for fetch_parse" },
      title: { type: "string", description: "Feed title (generate)" },
      link: { type: "string", description: "Feed link (generate)" },
      description: { type: "string", description: "Feed description (generate)" },
      items: { type: "string", description: "JSON array of items [{title, link, description, pubDate}]" },
      item: { type: "string", description: "JSON item to add {title, link, description}" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const input = String(params.input || "");
        return JSON.stringify(this.parse_feed(input));
      }
      case "fetch_parse": {
        const url = String(params.url || "");
        if (!url) return "Error: url is required";
        try {
          const resp = await fetch(url, { headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
          if (!resp.ok) return JSON.stringify({ error: `HTTP ${resp.status}` });
          const text = await resp.text();
          return JSON.stringify(this.parse_feed(text));
        } catch (e) {
          return JSON.stringify({ error: error_message(e) });
        }
      }
      case "generate": {
        const title = String(params.title || "Feed");
        const link = String(params.link || "");
        const description = String(params.description || "");
        let items: FeedItem[] = [];
        if (params.items) {
          try { items = JSON.parse(String(params.items)); } catch { return "Error: items must be valid JSON array"; }
        }
        const items_xml = items.map((item) => this.item_to_xml(item)).join("\n    ");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${this.escape_xml(title)}</title>
    <link>${this.escape_xml(link)}</link>
    <description>${this.escape_xml(description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items_xml}
  </channel>
</rss>`;
        return xml;
      }
      case "add_item": {
        const input = String(params.input || "");
        let item: FeedItem;
        try { item = JSON.parse(String(params.item || "{}")); } catch { return "Error: item must be valid JSON"; }
        const item_xml = this.item_to_xml(item);
        const insert_pos = input.lastIndexOf("</channel>");
        if (insert_pos === -1) return "Error: invalid RSS — no </channel> found";
        const result = input.slice(0, insert_pos) + "    " + item_xml + "\n  " + input.slice(insert_pos);
        return result;
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_feed(xml: string): { type: string; title: string; link: string; description: string; items: FeedItem[]; count: number } {
    const is_atom = xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"");
    const type = is_atom ? "atom" : "rss";

    const title = this.extract_tag(xml, is_atom ? "title" : "title", true) || "";
    const link = is_atom ? (this.extract_attr(xml, "link", "href") || "") : (this.extract_tag(xml, "link", true) || "");
    const description = this.extract_tag(xml, is_atom ? "subtitle" : "description", true) || "";

    const item_tag = is_atom ? "entry" : "item";
    const item_re = new RegExp(`<${item_tag}[^>]*>([\\s\\S]*?)</${item_tag}>`, "gi");
    const items: FeedItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = item_re.exec(xml))) {
      const content = m[1]!;
      items.push({
        title: this.extract_tag(content, "title") || "",
        link: is_atom ? (this.extract_attr(content, "link", "href") || "") : (this.extract_tag(content, "link") || ""),
        description: this.extract_tag(content, is_atom ? "summary" : "description") || this.extract_tag(content, "content") || "",
        pubDate: this.extract_tag(content, is_atom ? "updated" : "pubDate") || this.extract_tag(content, "published") || "",
        guid: this.extract_tag(content, is_atom ? "id" : "guid") || "",
        author: this.extract_tag(content, is_atom ? "name" : "author") || "",
      });
    }

    return { type, title, link, description, items, count: items.length };
  }

  private extract_tag(xml: string, tag: string, first_only = false): string | null {
    const re = first_only
      ? new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)
      : new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const m = re.exec(xml);
    return m ? m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : null;
  }

  private extract_attr(xml: string, tag: string, attr: string): string | null {
    const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
    const m = re.exec(xml);
    return m ? m[1]! : null;
  }

  private escape_xml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private item_to_xml(item: FeedItem): string {
    const parts = [`<item>`];
    parts.push(`      <title>${this.escape_xml(item.title)}</title>`);
    if (item.link) parts.push(`      <link>${this.escape_xml(item.link)}</link>`);
    if (item.description) parts.push(`      <description>${this.escape_xml(item.description)}</description>`);
    if (item.pubDate) parts.push(`      <pubDate>${item.pubDate}</pubDate>`);
    if (item.guid) parts.push(`      <guid>${this.escape_xml(item.guid)}</guid>`);
    parts.push(`    </item>`);
    return parts.join("\n    ");
  }
}
