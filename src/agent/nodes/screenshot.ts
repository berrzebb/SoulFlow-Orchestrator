/** Screenshot 노드 핸들러 — 워크플로우에서 웹 페이지 스크린샷 캡처. */

import type { NodeHandler } from "../node-registry.js";
import type { ScreenshotNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const screenshot_handler: NodeHandler = {
  node_type: "screenshot",
  icon: "\u{1F4F7}",
  color: "#ad1457",
  shape: "rect",
  output_schema: [
    { name: "output_path", type: "string",  description: "Path to saved screenshot" },
    { name: "success",     type: "boolean", description: "Whether capture succeeded" },
  ],
  input_schema: [
    { name: "url",      type: "string",  description: "URL to capture" },
    { name: "selector", type: "string",  description: "CSS selector for element capture" },
  ],
  create_default: () => ({ url: "", output_path: "", selector: "", full_page: false, width: 1280, height: 720, delay_ms: 1000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ScreenshotNodeDefinition;
    const tpl = { memory: ctx.memory };
    const url = resolve_templates(n.url || "", tpl);

    if (!url) return { output: { output_path: "", success: false, error: "url is required" } };

    try {
      const { ScreenshotTool } = await import("../tools/screenshot.js");
      const tool = new ScreenshotTool({ workspace: ctx.workspace || process.cwd() });
      const result = await tool.execute({
        url,
        output_path: resolve_templates(n.output_path || "", tpl),
        selector: n.selector || "",
        full_page: n.full_page ?? false,
        width: n.width || 1280,
        height: n.height || 720,
        delay_ms: n.delay_ms ?? 1000,
      }, { signal: ctx.abort_signal });

      const is_error = result.startsWith("Error:");
      if (is_error) return { output: { output_path: "", success: false, error: result } };

      const parsed = JSON.parse(result);
      return { output: { output_path: parsed.output_path || "", success: true } };
    } catch (err) {
      return { output: { output_path: "", success: false, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ScreenshotNodeDefinition;
    const warnings: string[] = [];
    if (!n.url?.trim()) warnings.push("url is required");
    return { preview: { url: n.url, full_page: n.full_page, viewport: `${n.width || 1280}x${n.height || 720}` }, warnings };
  },
};
