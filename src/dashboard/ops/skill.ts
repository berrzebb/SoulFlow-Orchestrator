/** Dashboard skill ops. */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { error_message } from "../../utils/common.js";
import { sanitize_filename, sanitize_rel_path, is_inside } from "./shared.js";
import type { DashboardSkillOps } from "../service.js";

export type SkillsLoaderLike = {
  list_skills(with_meta?: boolean): Array<Record<string, string>>;
  get_skill_metadata(name: string): Record<string, unknown> | null;
  refresh(): void;
  suggest_skills_for_text?(text: string, limit: number): unknown[];
};

export function create_skill_ops(deps: {
  skills_loader: SkillsLoaderLike;
  workspace: string;
}): DashboardSkillOps {
  const { skills_loader, workspace } = deps;
  return {
    list_skills: () => skills_loader.list_skills(),
    get_skill_detail: (name: string) => {
      const meta = skills_loader.get_skill_metadata(name);
      let content: string | null = null;
      let references: Array<{ name: string; content: string }> | null = null;
      if (meta?.path) {
        try { content = readFileSync(String(meta.path), "utf-8"); } catch { /* skip */ }
        const refs_dir = join(String(meta.path), "..", "references");
        if (existsSync(refs_dir)) {
          try {
            references = readdirSync(refs_dir)
              .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
              .map((f) => ({ name: f, content: readFileSync(join(refs_dir, f), "utf-8") }));
          } catch { /* skip */ }
        }
      }
      return { metadata: meta, content, references };
    },
    refresh: () => skills_loader.refresh(),
    write_skill_file: (name: string, file: string, content: string) => {
      try {
        const meta = skills_loader.get_skill_metadata(name);
        if (!meta?.path) return { ok: false, error: "skill_not_found" };
        if (String(meta.source ?? "").toLowerCase() === "builtin") return { ok: false, error: "builtin_readonly" };
        const safe_file = sanitize_filename(file);
        if (!safe_file) return { ok: false, error: "invalid_filename" };
        const skill_base = join(String(meta.path), "..");
        const target = safe_file === "SKILL.md"
          ? String(meta.path)
          : join(skill_base, "references", safe_file);
        if (!is_inside(skill_base, target)) return { ok: false, error: "path_traversal_blocked" };
        writeFileSync(target, content, "utf-8");
        skills_loader.refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
    upload_skill: (name, zip_buffer) => upload_skill_to(workspace, name, zip_buffer, skills_loader.refresh.bind(skills_loader)),
  };
}

function upload_skill_to(
  workspace: string, name: string, zip_buffer: Buffer, on_done?: () => void,
): { ok: boolean; path: string; error?: string } {
  try {
    const zip = new AdmZip(zip_buffer);
    const skill_dir = join(workspace, "skills", name);
    const entries = zip.getEntries();
    const top_dirs = new Set(entries.map((e: { entryName: string }) => e.entryName.split("/")[0]).filter(Boolean));
    const strip_prefix = top_dirs.size === 1 ? `${[...top_dirs][0]}/` : "";
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const rel = sanitize_rel_path(strip_prefix ? entry.entryName.replace(strip_prefix, "") : entry.entryName);
      if (!rel) continue;
      const target = join(skill_dir, rel);
      if (!is_inside(skill_dir, target)) continue;
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, entry.getData());
    }
    on_done?.();
    return { ok: true, path: skill_dir };
  } catch (e) {
    return { ok: false, path: "", error: error_message(e) };
  }
}

/** 기존 skill_ops의 upload 경로를 personal_dir로 override. reads는 유지. */
export function create_scoped_skill_ops(base: DashboardSkillOps, personal_dir: string): DashboardSkillOps {
  return {
    ...base,
    upload_skill: (name, zip_buffer) => upload_skill_to(personal_dir, name, zip_buffer, base.refresh),
  };
}
