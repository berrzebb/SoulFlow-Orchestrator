/** Canvas 도구 — 에이전트가 웹 채팅 UI에 인터랙티브 시각 컴포넌트를 렌더링. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import type { CanvasSpec } from "../../dashboard/canvas.types.js";
import { short_id } from "../../utils/common.js";

export type CanvasBroadcastCallback = (chat_id: string, spec: CanvasSpec) => void;

export class CanvasTool extends Tool {
  readonly name = "canvas_render";
  readonly category = "messaging" as const;
  readonly description =
    "Render an interactive visual canvas in the web chat UI. " +
    "Supports: text (headings, info/warn/error variants), metric cards, " +
    "charts (bar/line/pie), tables, images, forms with multiple field types, " +
    "and action buttons. Only available in web chat sessions.";

  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      canvas_id: {
        type: "string",
        description: "Unique canvas identifier. Reuse the same ID to update an existing canvas (default: auto-generated).",
      },
      title: { type: "string", description: "Canvas panel title shown in the header" },
      components: {
        type: "array",
        description:
          "Ordered list of UI components. Each component has a `type` field. " +
          "Supported types: text, metric, chart, table, image, form, button, divider. " +
          "See tool description for per-type fields.",
        items: { type: "object" },
      },
    },
    required: ["components"],
    additionalProperties: false,
  };

  private broadcast_callback: CanvasBroadcastCallback | null;

  constructor(args?: { broadcast_callback?: CanvasBroadcastCallback | null }) {
    super();
    this.broadcast_callback = args?.broadcast_callback ?? null;
  }

  set_broadcast_callback(cb: CanvasBroadcastCallback): void {
    this.broadcast_callback = cb;
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const chat_id = String(context?.chat_id || "").trim();
    if (!chat_id) return "Error: canvas_render requires a web chat context (chat_id not provided)";
    if (!this.broadcast_callback) return "Error: canvas_render is not configured for this channel";

    const components = params.components;
    if (!Array.isArray(components) || components.length === 0) {
      return "Error: components must be a non-empty array";
    }

    const canvas_id = String(params.canvas_id || "").trim() || `canvas-${short_id(8)}`;
    const title = String(params.title || "").trim() || undefined;

    const spec: CanvasSpec = {
      canvas_id,
      title,
      components: components as CanvasSpec["components"],
    };

    this.broadcast_callback(chat_id, spec);
    return JSON.stringify({ success: true, canvas_id }, null, 2);
  }
}
