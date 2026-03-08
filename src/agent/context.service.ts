import { SkillsLoader } from "./skills.js";
import { MemoryStore, type MemoryStoreLike } from "./memory.js";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { ContextMessage } from "./context.types.js";
import { DecisionService, PromiseService } from "../decision/index.js";
import { filter_tool_sections } from "../orchestration/tool-description-filter.js";
import { extract_persona_name } from "../orchestration/prompts.js";
import type { ReferenceStoreLike } from "../services/reference-store.js";

async function try_read_first_file(candidates: string[]): Promise<string> {
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = (await readFile(path, "utf-8")).trim();
    if (raw) return raw;
  }
  return "";
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/** OAuth 연동 요약 — 에이전트 컨텍스트 주입용. */
export interface OAuthIntegrationSummary {
  instance_id: string;
  service_type: string;
  label: string;
  scopes: string[];
  connected: boolean;
}

export type OAuthSummaryProvider = () => Promise<OAuthIntegrationSummary[]>;

export class ContextBuilder {
  readonly skills_loader: SkillsLoader;
  readonly memory_store: MemoryStoreLike;
  readonly decision_service: DecisionService;
  readonly promise_service: PromiseService;
  private readonly workspace: string;
  private _oauth_summary_provider: OAuthSummaryProvider | null = null;
  private _reference_store: ReferenceStoreLike | null = null;
  private _skill_ref_store: ReferenceStoreLike | null = null;
  private _daily_injection_days = 1;
  private _daily_injection_max_chars = 4_000;

  constructor(workspace: string, args?: { memory_store?: MemoryStoreLike; promises_dir?: string; app_root?: string }) {
    this.workspace = workspace;
    this.skills_loader = new SkillsLoader(workspace, args?.app_root);
    this.memory_store = args?.memory_store || new MemoryStore(workspace);
    this.decision_service = new DecisionService(workspace);
    this.promise_service = new PromiseService(workspace, args?.promises_dir);
  }

  set_reference_store(store: ReferenceStoreLike): void {
    this._reference_store = store;
  }

  set_skill_ref_store(store: ReferenceStoreLike): void {
    this._skill_ref_store = store;
  }

  /** SOUL.md에서 페르소나 이름을 추출. 미설정 시 "assistant". */
  get_persona_name(): string {
    const soul = this._read_file_sync("SOUL.md");
    return extract_persona_name(soul);
  }

  /** BOOTSTRAP.md 존재 여부 + 내용 반환. */
  get_bootstrap(): { exists: boolean; content: string } {
    const content = this._read_file_sync("BOOTSTRAP.md");
    return { exists: content.length > 0, content };
  }

  private _read_file_sync(name: string): string {
    for (const path of [join(this.workspace, "templates", name), join(this.workspace, name)]) {
      if (!existsSync(path)) continue;
      try { const raw = readFileSync(path, "utf-8").trim(); if (raw) return raw; } catch { /* skip */ }
    }
    return "";
  }

  set_daily_injection(days: number, max_chars?: number): void {
    this._daily_injection_days = Math.max(0, Math.min(30, days));
    if (max_chars !== undefined) this._daily_injection_max_chars = Math.max(0, max_chars);
  }

  set_oauth_summary_provider(provider: OAuthSummaryProvider): void {
    this._oauth_summary_provider = provider;
  }

  async build_system_prompt(
    skill_names: string[] = [],
    decision_context?: { team_id?: string | null; agent_id?: string | null },
    session_context?: { channel?: string | null; chat_id?: string | null },
    tool_categories?: ReadonlySet<string>,
  ): Promise<string> {
    const security_override = this._security_override_policy();
    const bootstrap = await this._load_bootstrap_files(tool_categories);
    const memory_context = await this._build_memory_context(session_context);
    const decision_ctx = { team_id: decision_context?.team_id || null, agent_id: decision_context?.agent_id || null };
    const decisions = await this.decision_service.build_compact_injection(decision_ctx);
    const promises = await this.promise_service.build_compact_injection(decision_ctx);
    const skills_content = this.skills_loader.load_skills_for_context(skill_names);
    const skill_summary = this.skills_loader.build_skill_summary();
    const oauth_section = await this._build_oauth_section();
    const current_session = this._build_current_session_section(session_context?.channel, session_context?.chat_id);
    return [
      security_override,
      bootstrap,
      memory_context,
      decisions || "",
      promises || "",
      skills_content ? `# Skills In Context\n${skills_content}` : "",
      `# Skills Summary\n${skill_summary || "(no skills found)"}`,
      oauth_section,
      MODEL_ROUTING_GUIDE,
      current_session,
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  /** 역할 기반 시스템 프롬프트. 서브에이전트 spawn 시 사용. */
  async build_role_system_prompt(
    role: string,
    skill_names?: string[],
    decision_context?: { team_id?: string | null; agent_id?: string | null },
    session_context?: { channel?: string | null; chat_id?: string | null },
  ): Promise<string> {
    const base = await this.build_system_prompt(
      skill_names || [],
      decision_context,
      session_context,
    );

    const role_context = this.skills_loader.load_role_context(role);
    if (!role_context) return base;

    const role_skill = this.skills_loader.get_role_skill(role);
    const persona_section = [
      role_skill?.soul ? `Soul: ${role_skill.soul}` : "",
      role_skill?.heart ? `Heart: ${role_skill.heart}` : "",
    ].filter(Boolean).join("\n");

    return [
      base,
      `# Role Context: ${role}\n${role_context}`,
      persona_section ? `# Persona\n${persona_section}` : "",
    ].filter(Boolean).join("\n\n").trim();
  }

  private _security_override_policy(): string {
    return [
      "# Security Override Policy",
      "- 민감정보/보안 규칙은 모든 다른 규칙보다 우선합니다.",
      "- 민감정보 평문을 출력/저장/재전송하지 않습니다.",
      "- 민감정보는 {{secret:<name>}} 참조 또는 암호문 상태로만 처리합니다.",
      "- 키를 식별할 수 없거나 복호화가 실패하면 작업을 중단하고 안내 템플릿으로 보고합니다.",
    ].join("\n");
  }

  async _load_bootstrap_files(tool_categories?: ReadonlySet<string>): Promise<string> {
    const names = ["AGENTS.md", "SOUL.md", "HEART.md", "USER.md", "TOOLS.md"];
    const parts: string[] = [];
    for (const name of names) {
      let raw = await try_read_first_file([
        join(this.workspace, "templates", name),
        join(this.workspace, name),
      ]);
      if (!raw) continue;
      if (name === "TOOLS.md" && tool_categories && tool_categories.size > 0) {
        raw = filter_tool_sections(raw, tool_categories);
      }
      parts.push(`# ${name}\n${raw}`);
    }
    return parts.join("\n\n");
  }

  async build_messages(
    history: string[],
    current_message: string,
    skill_names?: string[] | null,
    media?: string[] | null,
    channel?: string | null,
    chat_id?: string | null,
  ): Promise<ContextMessage[]> {
    const messages: ContextMessage[] = [];
    messages.push({
      role: "system",
      content: await this.build_system_prompt(
        skill_names || [],
        undefined,
        { channel: channel || null, chat_id: chat_id || null },
      ),
    });
    const history_block = await this._load_history_from_daily(history || []);
    if (history_block) {
      messages.push({
        role: "system",
        content: history_block,
      });
    }
    // Reference 문서 컨텍스트 주입 (사용자 메시지 기반 시멘틱 검색)
    const ref_context = await this._build_reference_context(current_message);
    if (ref_context) {
      messages.push({ role: "system", content: ref_context });
    }
    // 스킬 레퍼런스 컨텍스트 주입 (활성 스킬의 references/ 청크 검색)
    const skill_ref_context = await this._build_skill_reference_context(current_message, skill_names || []);
    if (skill_ref_context) {
      messages.push({ role: "system", content: skill_ref_context });
    }

    const user_content = this._build_user_content(current_message, media || []);
    messages.push({
      role: "user",
      content: user_content,
      channel: channel || undefined,
      chat_id: chat_id || undefined,
    });
    return messages;
  }

  _build_user_content(text: string, media?: string[] | null): string | ContextMessage[] {
    const normalized_media = media || [];
    if (normalized_media.length === 0) return text;
    const content: ContextMessage[] = [{ type: "text", text }];
    for (const url of normalized_media) {
      const data_uri = this._to_image_data_uri_if_local(url);
      if (data_uri) {
        content.push({
          type: "image_url",
          image_url: { url: data_uri },
        });
        continue;
      }
      content.push({
        type: "input_media",
        media_url: url,
      });
    }
    return content;
  }

  private _build_current_session_section(channel?: string | null, chat_id?: string | null): string {
    const ch = String(channel || "").trim();
    const id = String(chat_id || "").trim();
    if (!ch && !id) return "";
    return [
      "# Current Session",
      ch ? `Channel: ${ch}` : "",
      id ? `Chat ID: ${id}` : "",
    ].filter(Boolean).join("\n");
  }

  private async _build_reference_context(user_message: string): Promise<string> {
    if (!this._reference_store) return "";
    try {
      // sync 후 검색 (debounce 내장)
      await this._reference_store.sync();
      const results = await this._reference_store.search(user_message, { limit: 5 });
      if (results.length === 0) return "";
      const sections = results.map((r) =>
        `### ${r.doc_path}${r.heading ? ` — ${r.heading}` : ""}\n${r.content}`,
      );
      return `# Reference Documents\nsource: workspace/references/\nRelevance-ranked excerpts from project reference documents.\n\n${sections.join("\n\n---\n\n")}`;
    } catch {
      return "";
    }
  }

  private async _build_skill_reference_context(user_message: string, skill_names: string[]): Promise<string> {
    if (!this._skill_ref_store) return "";
    try {
      await this._skill_ref_store.sync();
      const filter = skill_names.length > 0 ? skill_names.join("|") : undefined;
      const results = await this._skill_ref_store.search(user_message, { limit: 4, doc_filter: filter });
      if (results.length === 0) return "";
      const sections = results.map((r) =>
        `### ${r.doc_path}${r.heading ? ` — ${r.heading}` : ""}\n${r.content}`,
      );
      return `# Skill Reference Docs\nsource: skills/references/\nRelevance-ranked excerpts from skill reference files.\n\n${sections.join("\n\n---\n\n")}`;
    } catch {
      return "";
    }
  }

  private async _build_memory_context(
    session_context?: { channel?: string | null; chat_id?: string | null },
  ): Promise<string> {
    const longterm = (await this.memory_store.read_longterm()).trim();
    const daily_section = await this._build_recent_daily_section(session_context);
    if (!longterm && !daily_section) return "";
    return [
      "# Memory",
      "source: memory.db",
      longterm ? `## Longterm\n${longterm}` : "",
      daily_section,
    ].filter(Boolean).join("\n\n");
  }

  private async _build_recent_daily_section(
    session_context?: { channel?: string | null; chat_id?: string | null },
  ): Promise<string> {
    if (this._daily_injection_days <= 0) return "";
    const all_days = await this.memory_store.list_daily();
    if (all_days.length === 0) return "";
    const recent = all_days.slice(-this._daily_injection_days);

    // session scope 필터: channel/chat_id가 있으면 해당 세션 엔트리만 포함
    const scope_prefix = session_context?.chat_id
      ? `${session_context.channel || ""}:${session_context.chat_id}:`
      : null;

    const max = this._daily_injection_max_chars;
    let total = 0;
    const chunks: string[] = [];

    // 최근 날짜부터 역순으로 수집 (최신 우선)
    for (let i = recent.length - 1; i >= 0; i--) {
      const day = recent[i];
      const raw = (await this.memory_store.read_daily(day)).trim();
      if (!raw) continue;

      const lines = raw.split("\n");
      const filtered = scope_prefix
        ? lines.filter((l) => l.includes(`[${scope_prefix}`) || !l.startsWith("- ["))
        : lines;
      if (filtered.length === 0) continue;
      const text = filtered.join("\n");

      if (max > 0 && total + text.length > max) {
        const remaining = max - total;
        if (remaining > 100) chunks.unshift(`### ${day}\n${text.slice(-remaining)}`);
        break;
      }
      total += text.length;
      chunks.unshift(`### ${day}\n${text}`);
    }
    if (chunks.length === 0) return "";
    return `## Recent Daily\n${chunks.join("\n\n")}`;
  }

  private async _build_oauth_section(): Promise<string> {
    if (!this._oauth_summary_provider) return "";
    try {
      const integrations = await this._oauth_summary_provider();
      const connected = integrations.filter((i) => i.connected);
      if (connected.length === 0) return "";
      const lines = [
        "# OAuth Integrations",
        "사용 가능한 OAuth 연동. oauth_fetch 도구로 인증된 API 호출 가능.",
        "",
      ];
      for (const i of connected) {
        lines.push(`- **${i.label}** (service_id: \`${i.instance_id}\`) — scopes: ${i.scopes.join(", ") || "none"}`);
      }
      lines.push("");
      lines.push("사용법: `oauth_fetch(service_id=\"<id>\", url=\"...\", method=\"GET\")`");
      lines.push("또는 http_request의 headers에 `{{secret:oauth.<id>.access_token}}` 플레이스홀더 사용.");
      return lines.join("\n");
    } catch {
      return "";
    }
  }

  private _to_image_data_uri_if_local(path_or_url: string): string | null {
    const raw = String(path_or_url || "").trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return null;
    if (/^data:/i.test(raw)) return raw;
    const ext = extname(raw).toLowerCase();
    const mime = IMAGE_MIME[ext] || null;
    if (!mime) return null;
    const resolved_path = isAbsolute(raw) ? raw : resolve(this.workspace, raw);
    const candidate = existsSync(raw) ? raw : resolved_path;
    try {
      if (!existsSync(candidate)) return null;
      const bytes = readFileSync(candidate);
      const b64 = Buffer.from(bytes).toString("base64");
      return `data:${mime};base64,${b64}`;
    } catch {
      return null;
    }
  }

  private async _load_history_from_daily(history_days: string[]): Promise<string> {
    const chunks: string[] = [];
    for (const day of history_days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const raw = (await this.memory_store.read_daily(day)).trim();
      if (!raw) continue;
      chunks.push(`## ${day}\n${raw}`);
    }
    if (chunks.length === 0) return "";
    return `# Daily Memory Context\nsource: memory.db\n\n${chunks.join("\n\n")}`;
  }

}

const MODEL_ROUTING_GUIDE = [
  "# Skill Model Routing",
  "- model:local → 직접 실행 (도구 호출, 단순 매핑)",
  "- model:remote → spawn 도구로 외부 모델의 서브에이전트 생성 (복잡한 추론 필요)",
  "- model 미지정 → 복잡도 판단하여 직접 또는 spawn",
].join("\n");
