/** ASCII Art 도구 — 텍스트 → ASCII 아트 변환, 박스/배너/테이블 생성. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const FONT_3X5: Record<string, string[]> = {
  A: [" # ", "# #", "###", "# #", "# #"], B: ["## ", "# #", "## ", "# #", "## "],
  C: [" ##", "#  ", "#  ", "#  ", " ##"], D: ["## ", "# #", "# #", "# #", "## "],
  E: ["###", "#  ", "## ", "#  ", "###"], F: ["###", "#  ", "## ", "#  ", "#  "],
  G: [" ##", "#  ", "# #", "# #", " ##"], H: ["# #", "# #", "###", "# #", "# #"],
  I: ["###", " # ", " # ", " # ", "###"], J: ["###", "  #", "  #", "# #", " # "],
  K: ["# #", "## ", "#  ", "## ", "# #"], L: ["#  ", "#  ", "#  ", "#  ", "###"],
  M: ["# #", "###", "###", "# #", "# #"], N: ["# #", "## ", "# #", " ##", "# #"],
  O: [" # ", "# #", "# #", "# #", " # "], P: ["## ", "# #", "## ", "#  ", "#  "],
  Q: [" # ", "# #", "# #", " # ", "  #"], R: ["## ", "# #", "## ", "# #", "# #"],
  S: [" ##", "#  ", " # ", "  #", "## "], T: ["###", " # ", " # ", " # ", " # "],
  U: ["# #", "# #", "# #", "# #", " # "], V: ["# #", "# #", "# #", " # ", " # "],
  W: ["# #", "# #", "###", "###", "# #"], X: ["# #", " # ", " # ", " # ", "# #"],
  Y: ["# #", "# #", " # ", " # ", " # "], Z: ["###", "  #", " # ", "#  ", "###"],
  "0": [" # ", "# #", "# #", "# #", " # "], "1": [" # ", "## ", " # ", " # ", "###"],
  "2": [" # ", "# #", "  #", " # ", "###"], "3": ["## ", "  #", " # ", "  #", "## "],
  "4": ["# #", "# #", "###", "  #", "  #"], "5": ["###", "#  ", "## ", "  #", "## "],
  "6": [" # ", "#  ", "## ", "# #", " # "], "7": ["###", "  #", " # ", " # ", " # "],
  "8": [" # ", "# #", " # ", "# #", " # "], "9": [" # ", "# #", " ##", "  #", " # "],
  " ": ["   ", "   ", "   ", "   ", "   "], "!": [" # ", " # ", " # ", "   ", " # "],
  ".": ["   ", "   ", "   ", "   ", " # "], "-": ["   ", "   ", "###", "   ", "   "],
  "?": [" # ", "# #", "  #", " # ", " # "],
};

export class AsciiArtTool extends Tool {
  readonly name = "ascii_art";
  readonly category = "data" as const;
  readonly description = "ASCII art utilities: banner, box, line, table, figlet, border.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["banner", "box", "line", "table", "figlet", "border"], description: "Operation" },
      text: { type: "string", description: "Text input" },
      char: { type: "string", description: "Character for line/border (default: -)" },
      width: { type: "number", description: "Width (default: 60)" },
      padding: { type: "number", description: "Padding inside box (default: 1)" },
      style: { type: "string", description: "Box style: single, double, round, heavy" },
      data: { type: "string", description: "JSON array of arrays for table" },
      headers: { type: "string", description: "JSON array of header strings" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "banner");

    switch (action) {
      case "banner":
      case "figlet": {
        const text = String(params.text || "").toUpperCase();
        const rows: string[] = ["", "", "", "", ""];
        for (const ch of text) {
          const glyph = FONT_3X5[ch] || FONT_3X5["?"];
          if (glyph) {
            for (let r = 0; r < 5; r++) rows[r] += (glyph[r] || "   ") + " ";
          }
        }
        return rows.map((r) => r.replace(/#/g, "\u2588").replace(/ /g, " ")).join("\n");
      }
      case "box": {
        const text = String(params.text || "");
        const pad = Number(params.padding) || 1;
        const style = String(params.style || "single");
        const chars = this.box_chars(style);
        const lines = text.split("\n");
        const max_len = Math.max(...lines.map((l) => l.length)) + pad * 2;
        const top = chars.tl + chars.h.repeat(max_len) + chars.tr;
        const bot = chars.bl + chars.h.repeat(max_len) + chars.br;
        const body = lines.map((l) => chars.v + " ".repeat(pad) + l.padEnd(max_len - pad) + chars.v);
        return [top, ...body, bot].join("\n");
      }
      case "line": {
        const ch = String(params.char || "-");
        const w = Number(params.width) || 60;
        return ch.repeat(w);
      }
      case "table": {
        let data: string[][];
        try { data = JSON.parse(String(params.data || "[]")); } catch { return "Error: invalid data JSON"; }
        let headers: string[] | undefined;
        if (params.headers) {
          try { headers = JSON.parse(String(params.headers)); } catch { /* skip */ }
        }
        return this.render_table(data, headers);
      }
      case "border": {
        const text = String(params.text || "");
        const ch = String(params.char || "*");
        const w = Number(params.width) || 60;
        const lines = text.split("\n");
        const top = ch.repeat(w);
        const body = lines.map((l) => `${ch} ${l.padEnd(w - 4)} ${ch}`);
        return [top, ...body, top].join("\n");
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private box_chars(style: string): { tl: string; tr: string; bl: string; br: string; h: string; v: string } {
    switch (style) {
      case "double": return { tl: "\u2554", tr: "\u2557", bl: "\u255A", br: "\u255D", h: "\u2550", v: "\u2551" };
      case "round": return { tl: "\u256D", tr: "\u256E", bl: "\u2570", br: "\u256F", h: "\u2500", v: "\u2502" };
      case "heavy": return { tl: "\u250F", tr: "\u2513", bl: "\u2517", br: "\u251B", h: "\u2501", v: "\u2503" };
      default: return { tl: "\u250C", tr: "\u2510", bl: "\u2514", br: "\u2518", h: "\u2500", v: "\u2502" };
    }
  }

  private render_table(data: string[][], headers?: string[]): string {
    const all = headers ? [headers, ...data] : data;
    if (all.length === 0) return "";
    const cols = Math.max(...all.map((r) => r.length));
    const widths: number[] = Array(cols).fill(0);
    for (const row of all) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], String(row[i] || "").length);
      }
    }
    const sep = "\u250C" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u252C") + "\u2510";
    const mid = "\u251C" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u253C") + "\u2524";
    const bot = "\u2514" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u2534") + "\u2518";
    const fmt_row = (row: string[]) => "\u2502" + widths.map((w, i) => ` ${String(row[i] || "").padEnd(w)} `).join("\u2502") + "\u2502";
    const lines = [sep];
    if (headers) {
      lines.push(fmt_row(headers));
      lines.push(mid);
      for (const row of data) lines.push(fmt_row(row));
    } else {
      for (const row of data) lines.push(fmt_row(row));
    }
    lines.push(bot);
    return lines.join("\n");
  }
}
