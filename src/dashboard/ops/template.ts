/** Dashboard template ops. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sanitize_filename, is_inside } from "./shared.js";
import type { DashboardTemplateOps } from "../service.js";

const TEMPLATE_NAMES = ["AGENTS", "SOUL", "HEART", "USER", "TOOLS", "HEARTBEAT"] as const;

export function create_template_ops(workspace: string): DashboardTemplateOps {
  const templates_dir = join(workspace, "templates");

  function resolve_path(name: string): string | null {
    const safe_name = sanitize_filename(name);
    if (!safe_name) return null;
    const in_templates = join(templates_dir, `${safe_name}.md`);
    if (is_inside(templates_dir, in_templates) && existsSync(in_templates)) return in_templates;
    const in_root = join(workspace, `${safe_name}.md`);
    if (is_inside(workspace, in_root) && existsSync(in_root)) return in_root;
    return null;
  }

  return {
    list() {
      return TEMPLATE_NAMES.map((name) => ({ name, exists: resolve_path(name) !== null }));
    },
    read(name: string) {
      const p = resolve_path(name);
      if (!p) return null;
      return readFileSync(p, "utf-8");
    },
    write(name: string, content: string) {
      const safe_name = sanitize_filename(name);
      if (!safe_name) return { ok: false };
      if (!mkdirSync(templates_dir, { recursive: true }) && !existsSync(templates_dir)) return { ok: false };
      const target = join(templates_dir, `${safe_name}.md`);
      if (!is_inside(templates_dir, target)) return { ok: false };
      writeFileSync(target, content, "utf-8");
      return { ok: true };
    },
  };
}
