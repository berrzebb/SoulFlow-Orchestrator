/** SVG 도구 — SVG 프리미티브 생성/차트/data URI 변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrs(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(" ");
}

export class SvgTool extends Tool {
  readonly name = "svg";
  readonly category = "data" as const;
  readonly description = "SVG primitives: rect, circle, line, path, text, group, viewBox, to_data_uri, chart.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["rect", "circle", "line", "path", "text", "group", "viewBox", "to_data_uri", "chart"], description: "Operation" },
      x: { type: "number" }, y: { type: "number" },
      width: { type: "number" }, height: { type: "number" },
      cx: { type: "number" }, cy: { type: "number" }, r: { type: "number" },
      x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" },
      d: { type: "string", description: "SVG path data" },
      content: { type: "string", description: "Text content or inner SVG" },
      fill: { type: "string" }, stroke: { type: "string" }, stroke_width: { type: "number" },
      rx: { type: "number" }, ry: { type: "number" },
      font_size: { type: "number" },
      children: { type: "string", description: "JSON array of SVG element strings for group" },
      svg: { type: "string", description: "Full SVG string for to_data_uri" },
      view_box: { type: "string", description: "viewBox attribute value" },
      chart_type: { type: "string", enum: ["bar", "line", "pie"], description: "Chart type" },
      data: { type: "string", description: "JSON array of {label, value} for chart" },
      title: { type: "string", description: "Chart title" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "rect");

    switch (action) {
      case "rect": {
        const a = attrs({
          x: params.x ?? 0, y: params.y ?? 0,
          width: params.width ?? 100, height: params.height ?? 100,
          rx: params.rx, ry: params.ry,
          fill: params.fill ?? "#4A90D9", stroke: params.stroke,
          "stroke-width": params.stroke_width,
        });
        return JSON.stringify({ svg: `<rect ${a}/>` });
      }
      case "circle": {
        const a = attrs({
          cx: params.cx ?? 50, cy: params.cy ?? 50, r: params.r ?? 40,
          fill: params.fill ?? "#4A90D9", stroke: params.stroke,
          "stroke-width": params.stroke_width,
        });
        return JSON.stringify({ svg: `<circle ${a}/>` });
      }
      case "line": {
        const a = attrs({
          x1: params.x1 ?? 0, y1: params.y1 ?? 0,
          x2: params.x2 ?? 100, y2: params.y2 ?? 100,
          stroke: params.stroke ?? "#333", "stroke-width": params.stroke_width ?? 2,
        });
        return JSON.stringify({ svg: `<line ${a}/>` });
      }
      case "path": {
        const a = attrs({
          d: params.d ?? "M0,0 L100,100",
          fill: params.fill ?? "none", stroke: params.stroke ?? "#333",
          "stroke-width": params.stroke_width ?? 2,
        });
        return JSON.stringify({ svg: `<path ${a}/>` });
      }
      case "text": {
        const content = esc(String(params.content || ""));
        const a = attrs({
          x: params.x ?? 0, y: params.y ?? 20,
          fill: params.fill ?? "#333", "font-size": params.font_size ?? 14,
        });
        return JSON.stringify({ svg: `<text ${a}>${content}</text>` });
      }
      case "group": {
        let children: string[];
        try { children = JSON.parse(String(params.children || "[]")); } catch { children = []; }
        const inner = children.join("\n  ");
        return JSON.stringify({ svg: `<g>\n  ${inner}\n</g>` });
      }
      case "viewBox": {
        const vb = String(params.view_box || `0 0 ${params.width || 400} ${params.height || 300}`);
        const w = params.width ?? 400;
        const h = params.height ?? 300;
        const content = String(params.content || "");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(vb)}" width="${w}" height="${h}">\n${content}\n</svg>`;
        return JSON.stringify({ svg });
      }
      case "to_data_uri": {
        const svg = String(params.svg || "");
        if (!svg) return JSON.stringify({ error: "svg is required" });
        const encoded = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
        return JSON.stringify({ data_uri: encoded, size: svg.length });
      }
      case "chart": {
        const chart_type = String(params.chart_type || "bar");
        let data: { label: string; value: number }[];
        try { data = JSON.parse(String(params.data || "[]")); } catch { return JSON.stringify({ error: "invalid data JSON" }); }
        if (data.length === 0) return JSON.stringify({ error: "data is empty" });
        const title = String(params.title || "");
        const w = Number(params.width || 400);
        const h = Number(params.height || 300);
        const svg = this.render_chart(chart_type, data, title, w, h);
        return JSON.stringify({ svg, chart_type, data_points: data.length });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private render_chart(type: string, data: { label: string; value: number }[], title: string, w: number, h: number): string {
    const pad = { top: title ? 40 : 20, right: 20, bottom: 40, left: 50 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    const max_val = Math.max(...data.map((d) => d.value), 1);
    const colors = ["#4A90D9", "#E74C3C", "#2ECC71", "#F39C12", "#9B59B6", "#1ABC9C", "#E67E22", "#3498DB"];
    const elements: string[] = [];

    if (title) elements.push(`<text x="${w / 2}" y="24" text-anchor="middle" font-size="16" fill="#333">${esc(title)}</text>`);

    if (type === "bar") {
      const bar_w = cw / data.length * 0.7;
      const gap = cw / data.length * 0.3;
      data.forEach((d, i) => {
        const bh = (d.value / max_val) * ch;
        const x = pad.left + i * (bar_w + gap) + gap / 2;
        const y = pad.top + ch - bh;
        elements.push(`<rect x="${x}" y="${y}" width="${bar_w}" height="${bh}" fill="${colors[i % colors.length]}"/>`);
        elements.push(`<text x="${x + bar_w / 2}" y="${h - 10}" text-anchor="middle" font-size="10" fill="#666">${esc(d.label)}</text>`);
      });
    } else if (type === "line") {
      const points = data.map((d, i) => {
        const x = pad.left + (i / Math.max(data.length - 1, 1)) * cw;
        const y = pad.top + ch - (d.value / max_val) * ch;
        return `${x},${y}`;
      });
      elements.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#4A90D9" stroke-width="2"/>`);
      data.forEach((d, i) => {
        const x = pad.left + (i / Math.max(data.length - 1, 1)) * cw;
        const y = pad.top + ch - (d.value / max_val) * ch;
        elements.push(`<circle cx="${x}" cy="${y}" r="3" fill="#4A90D9"/>`);
        elements.push(`<text x="${x}" y="${h - 10}" text-anchor="middle" font-size="10" fill="#666">${esc(d.label)}</text>`);
      });
    } else if (type === "pie") {
      const total = data.reduce((s, d) => s + d.value, 0);
      const cx = w / 2, cy = pad.top + ch / 2, r = Math.min(cw, ch) / 2 - 10;
      let angle = -Math.PI / 2;
      data.forEach((d, i) => {
        const slice = (d.value / total) * 2 * Math.PI;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle + slice);
        const y2 = cy + r * Math.sin(angle + slice);
        const large = slice > Math.PI ? 1 : 0;
        elements.push(`<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${colors[i % colors.length]}"/>`);
        angle += slice;
      });
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${elements.join("\n")}\n</svg>`;
  }
}
