import { SkillsLoader } from "./skills.js";
import { MemoryStore, type MemoryStoreLike } from "./memory.js";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { AgentContextSnapshot, ContextMessage } from "./context.types.js";
import { now_iso } from "../utils/common.js";
import { DecisionService, PromiseService } from "../decision/index.js";
import { load_all_personas, type RolePersona } from "./persona.js";

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

export class ContextBuilder {
  private readonly snapshots = new Map<string, AgentContextSnapshot>();
  private role_personas = new Map<string, RolePersona>();
  readonly skills_loader: SkillsLoader;
  readonly memory_store: MemoryStoreLike;
  readonly decision_service: DecisionService;
  readonly promise_service: PromiseService;
  private readonly workspace: string;

  constructor(workspace: string, args?: { memory_store?: MemoryStoreLike; promises_dir?: string }) {
    this.workspace = workspace;
    this.skills_loader = new SkillsLoader(workspace);
    this.memory_store = args?.memory_store || new MemoryStore(workspace);
    this.decision_service = new DecisionService(workspace);
    this.promise_service = new PromiseService(workspace, args?.promises_dir);
  }

  get_role_persona(role: string): RolePersona | null {
    return this.role_personas.get(role) || null;
  }

  /** once 모드 전용: identity + butler 페르소나 + 스킬 콘텐츠 포함 프롬프트. */
  async build_once_prompt(
    skill_names?: string[],
    session_context?: { channel?: string | null; chat_id?: string | null },
  ): Promise<string> {
    const identity = await this._get_identity();
    if (this.role_personas.size === 0) await this._load_roles_from_agents();
    const butler = this.get_role_persona("butler");
    const persona = butler?.body ? `# ROLE: BUTLER\n${butler.body}` : "";
    const skills_content = skill_names?.length
      ? this.skills_loader.load_skills_for_context(skill_names)
      : "";
    const current_session = this._build_current_session_section(session_context?.channel, session_context?.chat_id);
    return [
      identity,
      persona,
      skills_content ? `# Skills In Context\n${skills_content}` : "",
      current_session,
    ].filter(Boolean).join("\n\n").trim();
  }

  async build_system_prompt(
    skill_names: string[] = [],
    decision_context?: { team_id?: string | null; agent_id?: string | null },
    session_context?: { channel?: string | null; chat_id?: string | null },
  ): Promise<string> {
    const security_override = this._security_override_policy();
    const identity = await this._get_identity();
    const bootstrap = await this._load_bootstrap_files();
    const memory_context = await this._build_memory_context();
    const decision_ctx = { team_id: decision_context?.team_id || null, agent_id: decision_context?.agent_id || null };
    const decisions = await this.decision_service.build_compact_injection(decision_ctx);
    const promises = await this.promise_service.build_compact_injection(decision_ctx);
    const skills_content = this.skills_loader.load_skills_for_context(skill_names);
    const skill_summary = this.skills_loader.build_skill_summary();
    const current_session = this._build_current_session_section(session_context?.channel, session_context?.chat_id);
    return [
      security_override,
      identity,
      bootstrap,
      memory_context,
      decisions || "",
      promises || "",
      skills_content ? `# Skills In Context\n${skills_content}` : "",
      `# Skills Summary\n${skill_summary || "(no skills found)"}`,
      MODEL_ROUTING_GUIDE,
      current_session,
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
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

  async _get_identity(): Promise<string> {
    const raw = await try_read_first_file([
      join(this.workspace, "templates", "IDENTITY.md"),
      join(this.workspace, "IDENTITY.md"),
    ]);
    return raw || "You are a headless orchestration assistant.";
  }

  async _load_bootstrap_files(): Promise<string> {
    const names = ["AGENTS.md", "SOUL.md", "HEART.md", "USER.md", "TOOLS.md"];
    const parts: string[] = [];
    for (const name of names) {
      const raw = await try_read_first_file([
        join(this.workspace, "templates", name),
        join(this.workspace, name),
      ]);
      if (raw) parts.push(`# ${name}\n${raw}`);
    }
    const roles = await this._load_roles_from_agents();
    if (roles) parts.push(`# ROLES\n${roles}`);
    return parts.join("\n\n");
  }

  private async _load_roles_from_agents(): Promise<string> {
    const agents_dir = join(this.workspace, "agents");
    this.role_personas = await load_all_personas(agents_dir);
    if (this.role_personas.size === 0) return "";

    const chunks: string[] = [];
    for (const [role, persona] of this.role_personas) {
      if (!persona.body) continue;
      chunks.push(`## ${role}\n${persona.body}`);
    }
    return chunks.join("\n\n");
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

  private async _build_memory_context(): Promise<string> {
    const longterm = (await this.memory_store.read_longterm()).trim();
    if (!longterm) return "";
    return [
      "# Memory",
      "source: memory.db",
      `## Longterm\n${longterm}`,
    ].filter(Boolean).join("\n\n");
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

  add_tool_result(
    messages: ContextMessage[],
    tool_call_id: string,
    tool_name: string,
    result: string,
  ): ContextMessage[] {
    return [
      ...messages,
      {
        role: "tool",
        tool_call_id,
        name: tool_name,
        content: result,
      },
    ];
  }

  add_assistant_message(
    messages: ContextMessage[],
    content: string,
    tool_calls?: ContextMessage[] | null,
    reasoning_content?: string | null,
  ): ContextMessage[] {
    const message: ContextMessage = {
      role: "assistant",
      content,
    };
    if (tool_calls && tool_calls.length > 0) message.tool_calls = tool_calls;
    if (reasoning_content) message.reasoning_content = reasoning_content;
    return [...messages, message];
  }

  upsert(snapshot: AgentContextSnapshot): void {
    this.snapshots.set(snapshot.agentId, snapshot);
  }

  get(agentId: string): AgentContextSnapshot | null {
    return this.snapshots.get(agentId) || null;
  }

  async bootstrap(
    agentId: string,
    templates: Record<string, string>,
    options?: { teamId?: string; memory?: Record<string, unknown>; skills?: string[] },
  ): Promise<AgentContextSnapshot> {
    const alwaysSkills = this.skills_loader.get_always_skills();
    const longterm = await this.memory_store.read_longterm();
    const snap: AgentContextSnapshot = {
      agentId,
      teamId: options?.teamId,
      summary: "bootstrap_initialized",
      facts: Object.keys(templates).map((k) => `template:${k}`),
      bootstrap: {
        templates,
        injectedAt: now_iso(),
      },
      memory: { longterm, ...(options?.memory || {}) },
      skills: [...new Set([...(options?.skills || []), ...alwaysSkills])],
      tools: [],
      updatedAt: now_iso(),
    };
    this.snapshots.set(agentId, snap);
    return snap;
  }

  private update_snapshot(
    agentId: string,
    patch: Partial<AgentContextSnapshot>,
  ): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    if (!prev) return null;
    const next: AgentContextSnapshot = { ...prev, ...patch, updatedAt: now_iso() };
    this.snapshots.set(agentId, next);
    return next;
  }

  attach_memory(agentId: string, memory: Record<string, unknown>): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    return this.update_snapshot(agentId, {
      memory: { ...(prev?.memory || {}), ...memory },
    });
  }

  attach_skills(agentId: string, skills: string[]): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    return this.update_snapshot(agentId, {
      skills: [...new Set([...(prev?.skills || []), ...skills])],
    });
  }

  attach_tools(agentId: string, tools: string[]): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    return this.update_snapshot(agentId, {
      tools: [...new Set([...(prev?.tools || []), ...tools])],
    });
  }

}

const MODEL_ROUTING_GUIDE = [
  "# Skill Model Routing",
  "- model:local → 직접 실행 (도구 호출, 단순 매핑)",
  "- model:remote → spawn 도구로 외부 모델의 서브에이전트 생성 (복잡한 추론 필요)",
  "- model 미지정 → 복잡도 판단하여 직접 또는 spawn",
].join("\n");
