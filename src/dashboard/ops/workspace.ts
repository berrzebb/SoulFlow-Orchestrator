/** Dashboard workspace ops. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sanitize_rel_path } from "./shared.js";
import type { DashboardWorkspaceOps } from "../service.js";

export function create_workspace_ops(workspace_dir: string): DashboardWorkspaceOps {
  return {
    async list_files(rel_path = "") {
      const safe = sanitize_rel_path(rel_path);
      const abs = join(workspace_dir, safe);
      try {
        const entries = readdirSync(abs, { withFileTypes: true });
        return entries.map((e) => {
          const rel = safe ? `${safe}/${e.name}` : e.name;
          let size = 0; let mtime = 0;
          try { const st = statSync(join(abs, e.name)); size = st.size; mtime = st.mtimeMs; } catch { /* skip */ }
          return { name: e.name, rel, is_dir: e.isDirectory(), size, mtime };
        });
      } catch { return []; }
    },
    async read_file(rel_path) {
      const safe = sanitize_rel_path(rel_path);
      const abs = join(workspace_dir, safe);
      try { return readFileSync(abs, "utf-8"); } catch { return null; }
    },
  };
}
