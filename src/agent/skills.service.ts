import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { SkillMetadata, SkillSource, SkillType } from "./skills.types.js";

const SUMMARY_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your",
  "when", "what", "where", "which", "using", "use", "skill", "tools",
  "agent", "workflow", "builtin", "based", "only", "must", "should",
  "또는", "사용", "도구", "스킬", "작업", "요청", "처리",
]);

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

function collect_builtin_skill_roots(start: string): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  let current = resolve(start);
  while (true) {
    const candidates = [join(current, "src", "skills"), join(current, "builtin_skills")];
    for (const candidate of candidates) {
      const key = resolve(candidate).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (existsSync(candidate)) roots.push(candidate);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

export class SkillsLoader {
  private readonly workspace: string;
  private readonly workspace_skills_root: string;
  private readonly builtin_skills_roots: string[];

  private readonly workspace_skills = new Map<string, SkillMetadata>();
  private readonly builtin_skills = new Map<string, SkillMetadata>();
  private readonly merged = new Map<string, SkillMetadata>();
  private readonly raw_by_name = new Map<string, string>();
  private readonly alias_to_name = new Map<string, string>();
  /** _shared/ 프로토콜: 이름(확장자 제외) → 본문. 스킬 아님. */
  private readonly shared_protocols = new Map<string, string>();

  constructor(workspace: string) {
    this.workspace = workspace;
    this.workspace_skills_root = join(workspace, "skills");
    this.builtin_skills_roots = collect_builtin_skill_roots(workspace);
    this._scan_all();
  }

  /** 스킬 설치/삭제 후 명시적으로 호출. 일반 읽기 메서드에서는 캐시 사용. */
  refresh(): void {
    this._scan_all();
  }

  private _resolve_skill_name(name: string): string | null {
    const raw = String(name || "").trim();
    if (!raw) return null;
    if (this.merged.has(raw)) return raw;
    const normalized = this.normalize_skill_key(raw);
    const by_alias = this.alias_to_name.get(normalized);
    if (by_alias && this.merged.has(by_alias)) return by_alias;
    const lowered = raw.toLowerCase();
    for (const key of this.merged.keys()) {
      if (key.toLowerCase() === lowered) return key;
    }
    return null;
  }

  private _scan_all(): void {
    this.workspace_skills.clear();
    this.builtin_skills.clear();
    this.merged.clear();
    this.raw_by_name.clear();
    this.alias_to_name.clear();
    this.shared_protocols.clear();
    for (const root of this.builtin_skills_roots) {
      this._scan_source(root, "builtin_skills", this.builtin_skills);
    }
    this._scan_source(this.workspace_skills_root, "workspace_skills", this.workspace_skills);

    // .claude/commands/*.md — 워크스페이스 슬래시 커맨드 (스킬과 동일 취급)
    const commands_dir = join(this.workspace, ".claude", "commands");
    this._scan_flat_md(commands_dir, "workspace_commands", this.workspace_skills);

    // .claude/skills/*/SKILL.md — 워크스페이스 스킬 (SDK 호환 경로)
    const dot_claude_skills = join(this.workspace, ".claude", "skills");
    this._scan_source(dot_claude_skills, "workspace_skills", this.workspace_skills);

    for (const [k, v] of this.builtin_skills.entries()) this.merged.set(k, v);
    for (const [k, v] of this.workspace_skills.entries()) this.merged.set(k, v);
    for (const meta of this.merged.values()) {
      this.register_alias(meta.name, meta.name);
      for (const alias of meta.aliases) {
        this.register_alias(alias, meta.name);
      }
    }
    this._scan_shared_protocols();
  }

  /** _shared/ 디렉토리의 .md 파일을 프로토콜로 로드. 서브디렉토리는 네임스페이스 키 사용 (예: lang/typescript). */
  private _scan_shared_protocols(): void {
    const roots = [
      ...this.builtin_skills_roots.map((r) => join(r, "_shared")),
      join(this.workspace_skills_root, "_shared"),
    ];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      this._scan_shared_dir(root, root);
    }
  }

  private _scan_shared_dir(root: string, dir: string): void {
    for (const name of readdirSync(dir)) {
      const filePath = join(dir, name);
      const st = statSync(filePath);
      if (st.isDirectory()) {
        this._scan_shared_dir(root, filePath);
      } else if (st.isFile() && name.endsWith(".md")) {
        const rel = relative(root, filePath).replace(/\\/g, "/");
        const key = rel.replace(/\.md$/, "");
        if (!this.shared_protocols.has(key)) {
          this.shared_protocols.set(key, readFileSync(filePath, "utf-8").trim());
        }
      }
    }
  }

  private _scan_source(root: string, source: SkillSource, target: Map<string, SkillMetadata>): void {
    for (const skillPath of walk_skill_files(root)) {
      const raw = readFileSync(skillPath, "utf-8");
      const meta = this._parse_metadata(raw);
      const body = this._strip_formatter(raw);
      const rel = relative(root, skillPath).split(sep).join("/");
      const name = String(meta.name || meta.id || rel.replace(/\/SKILL\.md$/i, "").replace(/\//g, "."));
      const summary = String(meta.summary || meta.description || this._extract_summary(body));
      const always = Boolean(meta.always === true || meta.autoload === true || String(meta.load || "").toLowerCase() === "always");
      const requirements = Array.isArray(meta.requires) ? meta.requires.map((v) => String(v)) : [];
      const aliases = this.parse_meta_string_list(meta.aliases ?? meta.alias ?? meta.names);
      const triggers = this.parse_meta_string_list(meta.triggers ?? meta.trigger);
      const tools = this.parse_meta_string_list(meta.tools ?? meta.tool);
      const model = typeof meta.model === "string" ? meta.model.trim() || null : null;

      const type: SkillType = String(meta.type || "").toLowerCase() === "role" ? "role" : "tool";
      const role = type === "role" ? String(meta.role || "").trim() || null : null;
      const soul = typeof meta.soul === "string" ? meta.soul.trim() || null : null;
      const heart = typeof meta.heart === "string" ? meta.heart.trim() || null : null;
      const shared_protocols = this.parse_meta_string_list(meta.shared_protocols);
      const preferred_providers = this.parse_meta_string_list(meta.preferred_providers);
      const oauth = this.parse_meta_string_list(meta.oauth);
      if (oauth.length > 0 && !tools.includes("oauth_fetch")) tools.push("oauth_fetch");

      const skillMeta: SkillMetadata = {
        name,
        path: skillPath,
        source,
        type,
        always,
        summary,
        aliases,
        triggers,
        tools,
        requirements,
        model,
        frontmatter: meta,
        role,
        soul,
        heart,
        shared_protocols,
        preferred_providers,
        oauth,
      };
      target.set(name, skillMeta);
      this.raw_by_name.set(name, raw);
    }
  }

  /**
   * 디렉토리 내 *.md 파일을 직접 스캔. .claude/commands/ 용.
   * SKILL.MD 패턴이 아닌 파일명 기반 (review.md → "review").
   */
  private _scan_flat_md(
    dir: string,
    source: SkillSource,
    target: Map<string, SkillMetadata>,
    force_type?: SkillType,
  ): void {
    if (!existsSync(dir)) return;
    for (const filename of readdirSync(dir)) {
      if (!filename.endsWith(".md")) continue;
      const filePath = join(dir, filename);
      if (!statSync(filePath).isFile()) continue;
      const raw = readFileSync(filePath, "utf-8");
      const meta = this._parse_metadata(raw);
      const body = this._strip_formatter(raw);
      const name = String(meta.name || filename.replace(/\.md$/i, ""));
      if (target.has(name)) continue;
      const summary = String(meta.summary || meta.description || this._extract_summary(body));
      const always = Boolean(meta.always === true || String(meta.load || "").toLowerCase() === "always");
      const requirements = Array.isArray(meta.requires) ? meta.requires.map((v) => String(v)) : [];
      const aliases = this.parse_meta_string_list(meta.aliases ?? meta.alias);
      const triggers = this.parse_meta_string_list(meta.triggers ?? meta.trigger);
      const tools = this.parse_meta_string_list(meta.tools ?? meta.tool);
      const model = typeof meta.model === "string" ? meta.model.trim() || null : null;
      const type: SkillType = force_type ?? (String(meta.type || "").toLowerCase() === "role" ? "role" : "tool");
      const role = type === "role" ? String(meta.role || name).trim() || null : null;
      const soul = typeof meta.soul === "string" ? meta.soul.trim() || null : null;
      const heart = typeof meta.heart === "string" ? meta.heart.trim() || null : null;
      const shared_protocols = this.parse_meta_string_list(meta.shared_protocols);
      const preferred_providers = this.parse_meta_string_list(meta.preferred_providers);
      const oauth = this.parse_meta_string_list(meta.oauth);
      if (oauth.length > 0 && !tools.includes("oauth_fetch")) tools.push("oauth_fetch");

      target.set(name, {
        name,
        path: filePath,
        source,
        type,
        always,
        summary,
        aliases,
        triggers,
        tools,
        requirements,
        model,
        frontmatter: meta,
        role,
        soul,
        heart,
        shared_protocols,
        preferred_providers,
        oauth,
      });
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

  list_skills(filter_unavailable = false, type_filter?: SkillType): Array<Record<string, string>> {
    const out: Array<Record<string, string>> = [];
    for (const meta of this.merged.values()) {
      if (type_filter && meta.type !== type_filter) continue;
      if (filter_unavailable && !this._check_requirements(meta.frontmatter)) continue;
      out.push({
        name: meta.name,
        summary: meta.summary,
        source: meta.source,
        type: meta.type,
        always: meta.always ? "true" : "false",
        model: meta.model || "auto",
      });
    }
    return out;
  }

  load_skills_for_context(skill_names: string[]): string {

    const selected = new Set<string>();
    // Always skills are pinned in context only when requirements are satisfied.
    for (const meta of this.merged.values()) {
      if (meta.always && this._check_requirements(meta.frontmatter)) selected.add(meta.name);
    }
    for (const name of skill_names) {
      const resolved = this._resolve_skill_name(name);
      if (!resolved) continue;
      const meta = this.merged.get(resolved);
      if (!meta) continue;
      if (!this._check_requirements(meta.frontmatter)) continue;
      selected.add(resolved);
    }
    const parts: string[] = [];
    for (const name of selected) {
      const raw = this.raw_by_name.get(name);
      const content = raw ? this._strip_formatter(raw) : null;
      if (!content) continue;
      parts.push(`# skill:${name}\n${content}`.trim());
    }
    return parts.join("\n\n");
  }

  build_skill_summary(): string {
    const lines: string[] = [];
    for (const meta of this.merged.values()) {
      if (meta.type === "role") continue;
      if (!this._check_requirements(meta.frontmatter)) continue;
      const tags: string[] = [meta.source];
      if (meta.always) tags.push("always");
      if (meta.model) tags.push(`model:${meta.model}`);
      if (meta.tools.length > 0) tags.push(`tools:${meta.tools.join(",")}`);
      if (meta.oauth.length > 0) tags.push(`oauth:${meta.oauth.join(",")}`);
      lines.push(`- ${meta.name} [${tags.join(", ")}]: ${meta.summary}`);
    }
    return lines.join("\n");
  }

  suggest_skills_for_text(task: string, limit = 6): string[] {
    const max = Math.max(1, Math.min(20, Number(limit || 6)));
    const text_norm = this.normalize_text_for_match(task);
    if (!text_norm) return [];

    const scored: Array<{ name: string; score: number }> = [];
    for (const meta of this.merged.values()) {
      if (meta.type === "role") continue;
      if (!this._check_requirements(meta.frontmatter)) continue;
      let score = 0;
      const names = [...new Set([meta.name, ...meta.aliases])];
      for (const name of names) {
        const key = this.normalize_text_for_match(name);
        if (!key) continue;
        if (text_norm.includes(key)) {
          score += (name === meta.name ? 6 : 4);
        }
      }
      for (const trigger of meta.triggers) {
        const key = this.normalize_text_for_match(trigger);
        if (!key) continue;
        if (text_norm.includes(key)) {
          score += 5;
        }
      }
      if (score <= 0) {
        const summary_keywords = this.extract_summary_keywords(meta.summary);
        let keyword_hits = 0;
        for (const keyword of summary_keywords) {
          if (text_norm.includes(` ${keyword} `)) {
            score += 1;
            keyword_hits += 1;
            if (keyword_hits >= 3) break;
          }
        }
      }
      if (score > 0) scored.push({ name: meta.name, score });
    }

    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      })
      .slice(0, max)
      .map((row) => row.name);
  }

  get_skill_metadata(name: string): SkillMetadata | null {

    const resolved = this._resolve_skill_name(name);
    if (!resolved) return null;
    return this.merged.get(resolved) || null;
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
      const kv = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
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
      if (meta.always && this._check_requirements(meta.frontmatter)) out.push(meta.name);
    }
    return out;
  }

  /** 역할명으로 역할 스킬 조회. "implementer" → role:implementer 매핑. */
  get_role_skill(role: string): SkillMetadata | null {
    const target = String(role || "").trim();
    if (!target) return null;
    for (const meta of this.merged.values()) {
      if (meta.type !== "role") continue;
      if (meta.role === target) return meta;
    }
    return null;
  }

  /** 역할 스킬 본문 + _shared/ 프로토콜을 결합한 컨텍스트 문자열. */
  load_role_context(role: string): string | null {
    const meta = this.get_role_skill(role);
    if (!meta) return null;
    const raw = this.raw_by_name.get(meta.name);
    const body = raw ? this._strip_formatter(raw) : null;
    if (!body) return null;

    const parts: string[] = [];
    for (const proto_name of meta.shared_protocols) {
      const content = this.shared_protocols.get(proto_name);
      if (content) parts.push(`## protocol:${proto_name}\n${content}`);
    }
    parts.push(body);
    return parts.join("\n\n").trim();
  }

  /** 등록된 모든 역할 스킬 목록. */
  list_role_skills(): SkillMetadata[] {
    const out: SkillMetadata[] = [];
    for (const meta of this.merged.values()) {
      if (meta.type === "role") out.push(meta);
    }
    return out;
  }

  get_shared_protocol(name: string): string | null {
    return this.shared_protocols.get(name) || null;
  }

  private register_alias(alias_raw: string, name: string): void {
    const alias = this.normalize_skill_key(alias_raw);
    if (!alias) return;
    this.alias_to_name.set(alias, name);
  }

  private normalize_skill_key(value: string): string {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
  }

  private normalize_text_for_match(value: string): string {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/gi, " ")
      .replace(/\s+/g, " ");
    return normalized ? ` ${normalized} ` : "";
  }

  private parse_meta_string_list(value: unknown): string[] {
    const out: string[] = [];
    if (Array.isArray(value)) {
      for (const row of value) {
        const v = String(row || "").trim();
        if (v) out.push(v);
      }
      return [...new Set(out)];
    }
    const single = String(value || "").trim();
    if (!single) return [];
    if (single.includes(",")) {
      for (const part of single.split(",")) {
        const v = String(part || "").trim();
        if (v) out.push(v);
      }
      return [...new Set(out)];
    }
    return [single];
  }

  private extract_summary_keywords(summary: string): string[] {
    const tokens = String(summary || "")
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !SUMMARY_STOP_WORDS.has(t));
    return [...new Set(tokens)];
  }
}
