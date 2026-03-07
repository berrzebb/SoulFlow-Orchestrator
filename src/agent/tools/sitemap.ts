/** Sitemap 도구 — XML sitemap 생성/파싱. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class SitemapTool extends Tool {
  readonly name = "sitemap";
  readonly category = "data" as const;
  readonly description = "Sitemap utilities: generate, parse, validate, add_url, to_index.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "parse", "validate", "add_url", "to_index"], description: "Operation" },
      urls: { type: "string", description: "JSON array of URL entries [{loc, lastmod?, changefreq?, priority?}]" },
      sitemap: { type: "string", description: "Sitemap XML string (parse/validate)" },
      url: { type: "string", description: "URL to add (add_url)" },
      lastmod: { type: "string", description: "Last modification date" },
      changefreq: { type: "string", description: "Change frequency" },
      priority: { type: "string", description: "Priority (0.0-1.0)" },
      sitemaps: { type: "string", description: "JSON array of sitemap URLs (to_index)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");

    switch (action) {
      case "generate": {
        let urls: { loc: string; lastmod?: string; changefreq?: string; priority?: number }[];
        try { urls = JSON.parse(String(params.urls || "[]")); } catch { return JSON.stringify({ error: "invalid urls JSON" }); }
        return this.generate_sitemap(urls);
      }
      case "parse": {
        const xml = String(params.sitemap || "");
        return JSON.stringify(this.parse_sitemap(xml));
      }
      case "validate": {
        const xml = String(params.sitemap || "");
        const errors: string[] = [];
        if (!xml.includes("<urlset") && !xml.includes("<sitemapindex")) errors.push("missing <urlset> or <sitemapindex>");
        if (!xml.includes("xmlns")) errors.push("missing xmlns namespace");
        const urls = this.parse_sitemap(xml);
        for (const u of urls) {
          if (!u.loc) errors.push("URL entry missing <loc>");
          if (u.priority !== undefined && (u.priority < 0 || u.priority > 1)) errors.push(`invalid priority: ${u.priority}`);
        }
        return JSON.stringify({ valid: errors.length === 0, errors, url_count: urls.length });
      }
      case "add_url": {
        const xml = String(params.sitemap || "");
        const new_entry = `  <url>\n    <loc>${this.escape_xml(String(params.url || ""))}</loc>${params.lastmod ? `\n    <lastmod>${params.lastmod}</lastmod>` : ""}${params.changefreq ? `\n    <changefreq>${params.changefreq}</changefreq>` : ""}${params.priority ? `\n    <priority>${params.priority}</priority>` : ""}\n  </url>`;
        if (xml.includes("</urlset>")) {
          return xml.replace("</urlset>", `${new_entry}\n</urlset>`);
        }
        const urls: { loc: string; lastmod?: string; changefreq?: string; priority?: number }[] = [
          { loc: String(params.url || ""), lastmod: params.lastmod as string, changefreq: params.changefreq as string, priority: params.priority ? Number(params.priority) : undefined },
        ];
        return this.generate_sitemap(urls);
      }
      case "to_index": {
        let sitemaps: string[];
        try { sitemaps = JSON.parse(String(params.sitemaps || "[]")); } catch { return JSON.stringify({ error: "invalid sitemaps JSON" }); }
        const entries = sitemaps.map((s) => `  <sitemap>\n    <loc>${this.escape_xml(s)}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </sitemap>`);
        return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>`;
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private generate_sitemap(urls: { loc: string; lastmod?: string; changefreq?: string; priority?: number }[]): string {
    const entries = urls.map((u) => {
      let entry = `  <url>\n    <loc>${this.escape_xml(u.loc)}</loc>`;
      if (u.lastmod) entry += `\n    <lastmod>${u.lastmod}</lastmod>`;
      if (u.changefreq) entry += `\n    <changefreq>${u.changefreq}</changefreq>`;
      if (u.priority !== undefined) entry += `\n    <priority>${u.priority}</priority>`;
      entry += "\n  </url>";
      return entry;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`;
  }

  private parse_sitemap(xml: string): { loc: string; lastmod?: string; changefreq?: string; priority?: number }[] {
    const urls: { loc: string; lastmod?: string; changefreq?: string; priority?: number }[] = [];
    const url_re = /<url>([\s\S]*?)<\/url>/g;
    let match: RegExpExecArray | null;
    while ((match = url_re.exec(xml)) !== null) {
      const block = match[1];
      const loc = this.extract_tag(block, "loc");
      if (loc) {
        urls.push({
          loc,
          lastmod: this.extract_tag(block, "lastmod") || undefined,
          changefreq: this.extract_tag(block, "changefreq") || undefined,
          priority: this.extract_tag(block, "priority") ? Number(this.extract_tag(block, "priority")) : undefined,
        });
      }
    }
    return urls;
  }

  private extract_tag(xml: string, tag: string): string | null {
    const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
    const m = re.exec(xml);
    return m ? m[1].trim() : null;
  }

  private escape_xml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
