/** Web Form 도구 — agentBrowser로 웹 폼 자동 작성/제출. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { run_agent_browser } from "./agent-browser-client.js";

async function run_ab(args: string[], signal?: AbortSignal, timeout_ms = 30_000) {
  return run_agent_browser(args, { signal, timeout_ms });
}

export class WebFormTool extends Tool {
  readonly name = "web_form";
  readonly category = "web" as const;
  readonly policy_flags = { network: true, write: true } as const;
  readonly description = "Auto-fill and submit web forms. Provide field-to-value mapping and submit selector.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "Form page URL" },
      fields: { type: "object", description: "CSS-selector to value mapping, e.g. { '#email': 'test@test.com', '#password': '***' }" },
      submit_selector: { type: "string", description: "CSS selector for submit button" },
      wait_after_ms: { type: "integer", minimum: 0, maximum: 30000, description: "Wait after submit (ms)" },
      session: { type: "string", description: "Browser session name" },
    },
    required: ["url", "fields"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const url = String(params.url || "").trim();
    if (!url) return "Error: url is required";
    const fields = params.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "Error: fields must be an object";
    const entries = Object.entries(fields as Record<string, unknown>);
    if (entries.length === 0) return "Error: fields must have at least one entry";
    const submit = String(params.submit_selector || "").trim();
    const wait_after = Number(params.wait_after_ms || 2000);
    const session = String(params.session || "form-fill").trim();
    const base = ["--session", session];

    if (context?.signal?.aborted) return "Error: cancelled";

    const open_r = await run_ab([...base, "open", url, "--json"], context?.signal);
    if (!open_r.ok) return `Error: ${open_r.stderr}`;
    await run_ab([...base, "wait", "--load", "domcontentloaded", "--json"], context?.signal, 15_000);

    const results: Array<{ selector: string; ok: boolean; error?: string }> = [];
    for (const [selector, value] of entries) {
      const r = await run_ab([...base, "fill", selector, String(value || ""), "--json"], context?.signal);
      results.push({ selector, ok: r.ok, error: r.ok ? undefined : r.stderr });
    }

    let submit_result: { ok: boolean; error?: string } | null = null;
    if (submit) {
      const r = await run_ab([...base, "click", submit, "--json"], context?.signal);
      submit_result = { ok: r.ok, error: r.ok ? undefined : r.stderr };
      if (r.ok && wait_after > 0) {
        await run_ab([...base, "wait", String(wait_after), "--json"], context?.signal);
      }
    }

    let snapshot = "";
    const snap_r = await run_ab([...base, "snapshot", "-c", "-d", "6", "--json"], context?.signal);
    if (snap_r.ok) {
      try {
        const lines = snap_r.stdout.split(/\r?\n/).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const p = JSON.parse(lines[i]) as Record<string, unknown>;
            const data = p.data as Record<string, unknown> | undefined;
            snapshot = String(data?.snapshot || "").slice(0, 10_000);
            break;
          } catch { /* next */ }
        }
      } catch { /* ignore */ }
    }

    await run_ab([...base, "close", "--json"], context?.signal, 5_000).catch(() => {});

    return JSON.stringify({
      url,
      session,
      fields_filled: results,
      submit: submit_result,
      snapshot_preview: snapshot.slice(0, 2000) || "(none)",
    }, null, 2);
  }
}
