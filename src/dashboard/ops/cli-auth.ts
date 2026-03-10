/** Dashboard CLI auth ops. */

import type { DashboardCliAuthOps } from "../service.js";
import type { CliAuthService, CliType } from "../../agent/cli-auth.service.js";

export function create_cli_auth_ops(deps: {
  cli_auth: CliAuthService;
}): DashboardCliAuthOps {
  const valid_cli = (s: string): CliType | null =>
    s === "claude" || s === "codex" || s === "gemini" ? s : null;

  return {
    get_status: () => deps.cli_auth.get_all_cached(),
    check: async (cli) => {
      const t = valid_cli(cli);
      if (!t) return { cli, authenticated: false, error: "invalid cli type" };
      return deps.cli_auth.check(t);
    },
    check_all: () => deps.cli_auth.check_all(),
    start_login: async (cli) => {
      const t = valid_cli(cli);
      if (!t) return { cli, state: "failed", error: "invalid cli type" };
      return deps.cli_auth.start_login(t);
    },
    get_login_progress: (cli) => {
      const t = valid_cli(cli);
      if (!t) return null;
      return deps.cli_auth.get_login_progress(t);
    },
    get_oauth_port: (cli) => {
      const t = valid_cli(cli);
      if (!t) return null;
      return deps.cli_auth.get_oauth_port(t);
    },
    get_oauth_local_url: (cli) => {
      const t = valid_cli(cli);
      if (!t) return null;
      return deps.cli_auth.get_oauth_local_url(t);
    },
    cancel_login: (cli) => {
      const t = valid_cli(cli);
      if (!t) return { ok: false };
      return { ok: deps.cli_auth.cancel_login(t) };
    },
  };
}
