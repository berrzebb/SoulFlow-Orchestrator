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
  };
}
