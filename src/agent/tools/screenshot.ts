/** Screenshot 도구 — agentBrowser 기반 웹 페이지 스크린샷 캡처. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { error_message } from "../../utils/common.js";
import { run_agent_browser } from "./agent-browser-client.js";
import { join } from "node:path";

async function run_ab(args: string[], signal?: AbortSignal, timeout_ms = 30_000) {
  return run_agent_browser(args, { signal, timeout_ms });
}

export class ScreenshotTool extends Tool {
  readonly name = "screenshot";
  readonly category = "web" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Capture screenshots of web pages via headless browser. Supports full-page, viewport, and element-level capture.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to capture" },
      output_path: { type: "string", description: "File path to save screenshot (default: auto-generated)" },
      selector: { type: "string", description: "CSS selector to capture specific element" },
      full_page: { type: "boolean", description: "Capture full page scroll (default: false)" },
      width: { type: "integer", minimum: 320, maximum: 3840, description: "Viewport width (default: 1280)" },
      height: { type: "integer", minimum: 240, maximum: 2160, description: "Viewport height (default: 720)" },
      delay_ms: { type: "integer", minimum: 0, maximum: 10000, description: "Wait before capture in ms (default: 1000)" },
      session: { type: "string", description: "Browser session name" },
    },
    required: ["url"],
    additionalProperties: false,
  };

  private readonly workspace: string;
  constructor(opts?: { workspace?: string }) {
    super();
    this.workspace = opts?.workspace || process.cwd();
  }

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const url = String(params.url || "").trim();
    if (!url) return "Error: url is required";

    const session = String(params.session || "screenshot").trim();
    const width = Number(params.width || 1280);
    const height = Number(params.height || 720);
    const delay_ms = Number(params.delay_ms ?? 1000);
    const full_page = Boolean(params.full_page);
    const selector = String(params.selector || "").trim();
    const output_path = String(params.output_path || "").trim() ||
      join(this.workspace, `screenshot-${Date.now()}.png`);

    const base = ["--session", session];

    try {
      if (context?.signal?.aborted) return "Error: cancelled";

      const open_r = await run_ab([...base, "open", url, "--json"], context?.signal);
      if (!open_r.ok) return "Error: agent-browser not installed or failed to open page";

      await run_ab([...base, "wait", "--load", "domcontentloaded", "--json"], context?.signal, 15_000);

      if (delay_ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay_ms));
      }

      const screenshot_args = [...base, "screenshot", output_path, "--json"];
      if (full_page) screenshot_args.push("--full-page");
      if (selector) screenshot_args.push("--selector", selector);
      screenshot_args.push("--width", String(width), "--height", String(height));

      const r = await run_ab(screenshot_args, context?.signal, 30_000);
      await run_ab([...base, "close", "--json"], context?.signal, 5_000).catch(() => {});

      if (!r.ok) return "Error: screenshot capture failed";

      return JSON.stringify({
        success: true,
        url,
        output_path,
        viewport: `${width}x${height}`,
        full_page,
        selector: selector || null,
      }, null, 2);
    } catch (err) {
      await run_ab([...base, "close", "--json"], context?.signal, 5_000).catch(() => {});
      return `Error: ${error_message(err)}`;
    }
  }
}
