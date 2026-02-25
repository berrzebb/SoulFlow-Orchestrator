import { renderMermaid, renderMermaidAscii, THEMES } from "@vercel/beautiful-mermaid";
import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function trunc(text: string, max_chars: number): string {
  const raw = String(text || "");
  if (raw.length <= max_chars) return raw;
  return `${raw.slice(0, max_chars)}\n... (truncated)`;
}

function theme_map(): Record<string, Record<string, unknown>> {
  const raw = THEMES as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    out[k] = v as Record<string, unknown>;
  }
  return out;
}

function theme_names(): string[] {
  return Object.keys(theme_map()).sort((a, b) => a.localeCompare(b));
}

export class DiagramRenderTool extends Tool {
  readonly name = "diagram_render";
  readonly description = "Render Mermaid diagrams to SVG or ASCII using @vercel/beautiful-mermaid.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["render", "list_themes"] },
      diagram: { type: "string", description: "Mermaid diagram source text." },
      format: { type: "string", enum: ["svg", "ascii"], description: "Output format. Default: svg" },
      theme: { type: "string", description: "Theme for SVG output. Default: vercel-dark" },
      animate: { type: "boolean", description: "Enable rank-by-rank animation for SVG output." },
      use_ascii: { type: "boolean", description: "ASCII mode for format=ascii (false = Unicode box drawing)." },
      max_chars: { type: "integer", minimum: 1000, maximum: 2000000, description: "Output truncation limit." },
    },
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "render").trim().toLowerCase();
    if (action === "list_themes") {
      const names = theme_names();
      return JSON.stringify({ themes: names }, null, 2);
    }
    if (action !== "render") return `Error: unsupported action '${action}'`;

    const diagram = String(params.diagram || "").trim();
    if (!diagram) return "Error: diagram is required";
    if (context?.signal?.aborted) return "Error: cancelled";

    const format = String(params.format || "svg").trim().toLowerCase();
    const max_chars = clamp(Number(params.max_chars || 2_000_000), 1000, 2_000_000);

    if (format === "ascii") {
      try {
        const ascii = renderMermaidAscii(diagram, { useAscii: params.use_ascii === true });
        return trunc(ascii, max_chars);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    }

    if (format === "svg") {
      const all_themes = theme_map();
      const names = Object.keys(all_themes);
      const theme = String(params.theme || "vercel-dark").trim() || "vercel-dark";
      const render_options: Record<string, unknown> = { animate: params.animate === true };
      if (names.length > 0) {
        const theme_values = all_themes[theme];
        if (!theme_values) return `Error: unknown_theme '${theme}'. available: ${names.join(", ")}`;
        Object.assign(render_options, theme_values);
      }
      try {
        const svg = await renderMermaid(diagram, render_options);
        return trunc(svg, max_chars);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error: ${message}`;
      }
    }

    return `Error: unsupported format '${format}'`;
  }
}
