import { escape_html } from "../utils/common.js";
import type { RenderMode } from "./rendering.js";

/** 구조화된 콘텐츠 블록. 에이전트 응답이나 도구 결과를 채널 형식으로 변환. */
export type ContentBlock =
  | { type: "text"; value: string }
  | { type: "code"; language?: string; value: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "image"; url: string; alt?: string }
  | { type: "chart"; kind: "bar" | "line" | "pie"; title?: string; data: ChartDataPoint[] }
  | { type: "media"; url: string; name?: string; mime?: string };

export type ChartDataPoint = { label: string; value: number };

export type ContentRendererOptions = {
  mode: RenderMode;
  max_table_rows?: number;
  max_chart_width?: number;
};

/** 구조화된 블록을 채널 출력으로 변환. */
export function render_content_blocks(blocks: ContentBlock[], options: ContentRendererOptions): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const rendered = render_block(block, options);
    if (rendered) parts.push(rendered);
  }
  return parts.join("\n\n");
}

function render_block(block: ContentBlock, options: ContentRendererOptions): string {
  switch (block.type) {
    case "text": return block.value.trim();
    case "code": return render_code(block.language, block.value, options.mode);
    case "table": return render_table(block.headers, block.rows, options);
    case "image": return render_image(block.url, block.alt, options.mode);
    case "chart": return render_chart(block, options);
    case "media": return render_media(block, options.mode);
    default: return "";
  }
}

function render_code(language: string | undefined, value: string, mode: RenderMode): string {
  const lang = language || "";
  if (mode === "html") {
    const escaped = escape_html(value);
    return `<pre><code>${escaped}</code></pre>`;
  }
  return `\`\`\`${lang}\n${value}\n\`\`\``;
}

function render_table(headers: string[], rows: string[][], options: ContentRendererOptions): string {
  const max = options.max_table_rows ?? 50;
  const capped = rows.slice(0, max);

  if (options.mode === "html") return render_table_html(headers, capped);
  if (options.mode === "plain") return render_table_ascii(headers, capped);
  return render_table_markdown(headers, capped);
}

function render_table_markdown(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";
  const header_line = `| ${headers.join(" | ")} |`;
  const sep_line = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${pad_row(r, headers.length).join(" | ")} |`);
  return [header_line, sep_line, ...body].join("\n");
}

function render_table_html(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${escape_html(h)}</th>`).join("");
  const tr_rows = rows.map((r) => {
    const tds = pad_row(r, headers.length).map((c) => `<td>${escape_html(c)}</td>`).join("");
    return `<tr>${tds}</tr>`;
  });
  return `<table><tr>${th}</tr>${tr_rows.join("")}</table>`;
}

function render_table_ascii(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) =>
    Math.min(30, Math.max(...all.map((r) => (r[col] || "").length))),
  );
  const pad = (s: string, w: number) => s.slice(0, w).padEnd(w);
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const header_line = widths.map((w, i) => pad(headers[i] || "", w)).join(" | ");
  const body = rows.map((r) =>
    widths.map((w, i) => pad(r[i] || "", w)).join(" | "),
  );
  return [header_line, sep, ...body].join("\n");
}

function render_image(url: string, alt: string | undefined, mode: RenderMode): string {
  const label = alt || "image";
  if (mode === "html") return `<a href="${escape_html(url)}">${escape_html(label)}</a>`;
  if (mode === "plain") return `[${label}] ${url}`;
  return `![${label}](${url})`;
}

function render_media(block: { url: string; name?: string; mime?: string }, mode: RenderMode): string {
  const name = block.name || block.url.split("/").pop() || "file";
  if (mode === "html") return `<a href="${escape_html(block.url)}">${escape_html(name)}</a>`;
  if (mode === "plain") return `[${name}] ${block.url}`;
  return `[${name}](${block.url})`;
}

function render_chart(block: Extract<ContentBlock, { type: "chart" }>, options: ContentRendererOptions): string {
  const title = block.title ? `${block.title}\n` : "";
  if (block.kind === "pie") return `${title}${render_pie(block.data)}`;
  if (block.kind === "line") return `${title}${render_line(block.data, options)}`;
  return `${title}${render_bar(block.data, options)}`;
}

/** 가로 막대 차트 (ASCII). */
export function render_bar(data: ChartDataPoint[], options?: Pick<ContentRendererOptions, "max_chart_width">): string {
  if (data.length === 0) return "";
  const max_width = options?.max_chart_width ?? 30;
  const max_val = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const label_width = Math.max(...data.map((d) => d.label.length));
  return data.map((d) => {
    const bar_len = Math.round((Math.abs(d.value) / max_val) * max_width);
    const bar = "█".repeat(bar_len) || "▏";
    return `${d.label.padEnd(label_width)} ${bar} ${d.value}`;
  }).join("\n");
}

/** 간이 라인 차트 (ASCII sparkline). */
export function render_line(data: ChartDataPoint[], options?: Pick<ContentRendererOptions, "max_chart_width">): string {
  if (data.length === 0) return "";
  const SPARKS = "▁▂▃▄▅▆▇█";
  const max_width = options?.max_chart_width ?? 40;
  const values = data.slice(0, max_width).map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const spark = values.map((v) => SPARKS[Math.round(((v - min) / range) * (SPARKS.length - 1))]).join("");
  const labels_line = `${data[0].label} → ${data[data.length - 1].label}`;
  return `${spark}\n${labels_line} (min: ${min}, max: ${max})`;
}

/** 파이 차트 (텍스트 백분율 표시). */
export function render_pie(data: ChartDataPoint[]): string {
  if (data.length === 0) return "";
  const total = data.reduce((sum, d) => sum + Math.abs(d.value), 0) || 1;
  const label_width = Math.max(...data.map((d) => d.label.length));
  return data.map((d) => {
    const pct = ((Math.abs(d.value) / total) * 100).toFixed(1);
    const bar = "●".repeat(Math.max(1, Math.round(Number(pct) / 5)));
    return `${d.label.padEnd(label_width)} ${bar} ${pct}%`;
  }).join("\n");
}

function pad_row(row: string[], length: number): string[] {
  const out = [...row];
  while (out.length < length) out.push("");
  return out.slice(0, length);
}

