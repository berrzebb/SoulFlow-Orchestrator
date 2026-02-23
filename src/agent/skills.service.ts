import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SkillMetadata, SkillSource } from "./skills.types.js";

function walk_skill_files(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!existsSync(current)) continue;
    for (const name of readdirSync(current)) {
      const filePath = join(current, name);
      const st = statSync(filePath);
      if (st.isDirectory()) stack.push(filePath);
      else if (st.isFile() && name.toUpperCase() === "SKILL.MD") out.push(filePath);
    }
  }
  return out;
}

export class SkillsLoader {
  private readonly workspace: string;
  private readonly workspace_skills_root: string;
  private readonly builtin_skills_roots: string[];

  private readonly workspace_skills = new Map<string, SkillMetadata>();
  private readonly builtin_skills = new Map<string, SkillMetadata>();
  private readonly merged = new Map<string, SkillMetadata>();
  private readonly raw_by_name = new Map<string, string>();

  constructor(workspace: string) {
    this.workspace = workspace;
    this.workspace_skills_root = join(workspace, "skills");
    this.builtin_skills_roots = [
      join(workspace, "src", "skills"),
      join(workspace, "builtin_skills"),
    ];
    this._scan_all();
  }

  private _scan_all(): void {
    this.workspace_skills.clear();
    this.builtin_skills.clear();
    this.merged.clear();
    this.raw_by_name.clear();
    for (const root of this.builtin_skills_roots) {
      this._scan_source(root, "builtin_skills", this.builtin_skills);
    }
    this._scan_source(this.workspace_skills_root, "workspace_skills", this.workspace_skills);

    for (const [k, v] of this.builtin_skills.entries()) this.merged.set(k, v);
    for (const [k, v] of this.workspace_skills.entries()) this.merged.set(k, v);
  }

  private _scan_source(root: string, source: SkillSource, target: Map<string, SkillMetadata>): void {
    for (const skillPath of walk_skill_files(root)) {
      const raw = readFileSync(skillPath, "utf-8");
      const meta = this._parse_metadata(raw);
      const body = this._strip_formatter(raw);
      const rel = relative(root, skillPath).split(sep).join("/");
      const name = String(meta.name || meta.id || rel.replace(/\/SKILL\.md$/i, "").replace(/\//g, "."));
      const summary = String(meta.summary || this._extract_summary(body));
      const always = Boolean(meta.always === true || meta.autoload === true || String(meta.load || "").toLowerCase() === "always");
      const requirements = Array.isArray(meta.requires) ? meta.requires.map((v) => String(v)) : [];

      const skillMeta: SkillMetadata = {
        name,
        path: skillPath,
        source,
        always,
        summary,
        requirements,
        frontmatter: meta,
      };
      target.set(name, skillMeta);
      this.raw_by_name.set(name, raw);
    }
  }

  private _extract_summary(content: string): string {
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      return t;
    }
    return "No summary.";
  }

  list_skills(filter_unavailable = false): Array<Record<string, string>> {
    const out: Array<Record<string, string>> = [];
    for (const meta of this.merged.values()) {
      if (filter_unavailable && !this._check_requirements(meta.frontmatter)) continue;
      out.push({
        name: meta.name,
        summary: meta.summary,
        source: meta.source,
        always: meta.always ? "true" : "false",
      });
    }
    return out;
  }

  load_skills(name: string): string | null {
    const raw = this.raw_by_name.get(name);
    if (!raw) return null;
    return this._strip_formatter(raw);
  }

  load_skills_for_context(skill_names: string[]): string {
    const parts: string[] = [];
    for (const name of skill_names) {
      const content = this.load_skills(name);
      if (!content) continue;
      parts.push(`# skill:${name}\n${content}`.trim());
    }
    return parts.join("\n\n");
  }

  build_skill_summary(): string {
    const rows = this.list_skills(false);
    return rows.map((r) => `- ${r.name} [${r.source}]${r.always === "true" ? " [always]" : ""}: ${r.summary}`).join("\n");
  }

  get_missing_requirements(name: string): string {
    const meta = this.get_skill_meta(name);
    if (!meta) return "skill_not_found";
    return this._get_missing_requirements(meta);
  }

  get_skill_meta(name: string): Record<string, unknown> | null {
    const meta = this.merged.get(name);
    return meta ? { ...meta.frontmatter } : null;
  }

  _get_missing_requirements(skill_meta: Record<string, unknown>): string {
    const requires = Array.isArray(skill_meta.requires) ? skill_meta.requires.map((v) => String(v)) : [];
    const missing: string[] = [];
    for (const req of requires) {
      const optional = req.startsWith("?");
      const value = optional ? req.slice(1) : req;
      const match = value.match(/^(env|file):(.+)$/i);
      if (!match) continue;
      const kind = match[1].toLowerCase();
      const key = match[2].trim();
      if (kind === "env") {
        if (!process.env[key] && !optional) missing.push(`env:${key}`);
      } else if (kind === "file") {
        const ok = existsSync(key) || existsSync(join(this.workspace, key));
        if (!ok && !optional) missing.push(`file:${key}`);
      }
    }
    return missing.join(", ");
  }

  _strip_formatter(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
    return (match ? match[1] : content).trim();
  }

  _parse_metadata(raw: string): Record<string, unknown> {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return {};
    const out: Record<string, unknown> = {};
    let activeListKey = "";
    for (const line of match[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const listItem = trimmed.match(/^- (.+)$/);
      if (listItem && activeListKey) {
        const prev = (out[activeListKey] as unknown[]) || [];
        prev.push(listItem[1].trim());
        out[activeListKey] = prev;
        continue;
      }
      const kv = trimmed.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const rhs = kv[2].trim();
      if (!rhs) {
        out[key] = [];
        activeListKey = key;
        continue;
      }
      if (rhs === "true") out[key] = true;
      else if (rhs === "false") out[key] = false;
      else out[key] = rhs.replace(/^["']|["']$/g, "");
      activeListKey = "";
    }
    return out;
  }

  _check_requirements(skill_meta: Record<string, unknown>): boolean {
    return this._get_missing_requirements(skill_meta).length === 0;
  }

  get_always_skills(): string[] {
    const out: string[] = [];
    for (const meta of this.merged.values()) {
      if (meta.always) out.push(meta.name);
    }
    return out;
  }

  get_skill_metadata(name: string): Record<string, unknown> | null {
    const meta = this.merged.get(name);
    if (!meta) return null;
    return {
      name: meta.name,
      source: meta.source,
      summary: meta.summary,
      always: meta.always,
      requirements: meta.requirements,
      path: meta.path,
      frontmatter: { ...meta.frontmatter },
    };
  }
}
