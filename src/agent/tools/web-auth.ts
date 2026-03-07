/** Web Auth 도구 — agentBrowser 세션 기반 로그인/인증 관리. */

import { Tool } from "./base.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";
import { run_agent_browser } from "./agent-browser-client.js";

async function run_ab(args: string[], signal?: AbortSignal, timeout_ms = 30_000) {
  return run_agent_browser(args, { signal, timeout_ms });
}

export class WebAuthTool extends Tool {
  readonly name = "web_auth";
  readonly category = "web" as const;
  readonly policy_flags = { network: true, write: true } as const;
  readonly description = "Browser-based login: fill credentials, submit, persist session cookies.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      login_url: { type: "string", description: "Login page URL" },
      username_selector: { type: "string", description: "CSS selector for username/email field" },
      password_selector: { type: "string", description: "CSS selector for password field" },
      submit_selector: { type: "string", description: "CSS selector for submit button" },
      username: { type: "string", description: "Username/email value" },
      password: { type: "string", description: "Password value (use {{secret:name}} for secure injection)" },
      session: { type: "string", description: "Session name (persisted for reuse)" },
      success_indicator: { type: "string", description: "CSS selector that appears after successful login" },
      wait_after_ms: { type: "integer", minimum: 0, maximum: 30000, description: "Wait after submit (ms)" },
    },
    required: ["login_url", "username_selector", "password_selector", "submit_selector", "username", "password"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const url = String(params.login_url || "").trim();
    if (!url) return "Error: login_url is required";
    const session = String(params.session || "auth").trim();
    const base = ["--session", session];
    const wait_after = Number(params.wait_after_ms || 3000);

    if (context?.signal?.aborted) return "Error: cancelled";

    const open_r = await run_ab([...base, "open", url, "--json"], context?.signal);
    if (!open_r.ok) return `Error: ${open_r.stderr}`;
    await run_ab([...base, "wait", "--load", "domcontentloaded", "--json"], context?.signal, 15_000);

    const fill_user = await run_ab([...base, "fill", String(params.username_selector), String(params.username), "--json"], context?.signal);
    if (!fill_user.ok) return `Error: failed to fill username — ${fill_user.stderr}`;

    const fill_pass = await run_ab([...base, "fill", String(params.password_selector), String(params.password), "--json"], context?.signal);
    if (!fill_pass.ok) return `Error: failed to fill password — ${fill_pass.stderr}`;

    const submit = await run_ab([...base, "click", String(params.submit_selector), "--json"], context?.signal);
    if (!submit.ok) return `Error: failed to click submit — ${submit.stderr}`;

    if (wait_after > 0) {
      await run_ab([...base, "wait", String(wait_after), "--json"], context?.signal);
    }

    let success = false;
    const indicator = String(params.success_indicator || "").trim();
    if (indicator) {
      const check = await run_ab([...base, "get", "text", indicator, "--json"], context?.signal, 5_000);
      success = check.ok;
    } else {
      success = true;
    }

    return JSON.stringify({
      url,
      session,
      authenticated: success,
      note: success ? `Session "${session}" ready. Use --session ${session} in other web tools.` : "Login may have failed. Check success_indicator.",
    }, null, 2);
  }
}
