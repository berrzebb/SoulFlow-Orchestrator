import { SkillsLoader } from "./skills.js";
import { MemoryStore, type MemoryStoreLike } from "./memory.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { AgentContextSnapshot, ContextMessage } from "./context.types.js";
import { now_iso } from "../utils/common.js";
import { DecisionService } from "../decision/index.js";

export class ContextBuilder {
  private readonly snapshots = new Map<string, AgentContextSnapshot>();
  readonly skills_loader: SkillsLoader;
  readonly memory_store: MemoryStoreLike;
  readonly decision_service: DecisionService;
  private readonly workspace: string;

  constructor(workspace: string, args?: { memory_store?: MemoryStoreLike }) {
    this.workspace = workspace;
    this.skills_loader = new SkillsLoader(workspace);
    this.memory_store = args?.memory_store || new MemoryStore(workspace);
    this.decision_service = new DecisionService(workspace);
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
    const decisions = await this.decision_service.build_compact_injection({
      team_id: decision_context?.team_id || null,
      agent_id: decision_context?.agent_id || null,
    });
    const skills_content = this.skills_loader.load_skills_for_context(skill_names);
    const skill_summary = this.skills_loader.build_skill_summary();
    const current_session = this._build_current_session_section(session_context?.channel, session_context?.chat_id);
    return [
      security_override,
      identity,
      bootstrap,
      memory_context,
      decisions || "",
      skills_content ? `# Skills In Context\n${skills_content}` : "",
      `# Skills Summary\n${skill_summary || "(no skills found)"}`,
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
    const candidates = [
      join(this.workspace, "templates", "IDENTITY.md"),
      join(this.workspace, "IDENTITY.md"),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const raw = (await readFile(path, "utf-8")).trim();
      if (raw) return raw;
    }
    return "You are a headless orchestration assistant.";
  }

  async _load_bootstrap_files(): Promise<string> {
    const names = ["AGENTS.md", "SOUL.md", "HEART.md", "USER.md", "TOOLS.md"];
    const parts: string[] = [];
    for (const name of names) {
      const candidates = [join(this.workspace, "templates", name), join(this.workspace, name)];
      for (const path of candidates) {
        if (!existsSync(path)) continue;
        const raw = (await readFile(path, "utf-8")).trim();
        if (!raw) continue;
        parts.push(`# ${name}\n${raw}`);
        break;
      }
    }
    const roles = await this._load_roles_from_agents();
    if (roles) parts.push(`# ROLES\n${roles}`);
    return parts.join("\n\n");
  }

  private async _load_roles_from_agents(): Promise<string> {
    const agents_dir = join(this.workspace, "agents");
    if (!existsSync(agents_dir)) return "";
    const files = readdirSync(agents_dir)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));
    if (files.length === 0) return "";

    const chunks: string[] = [];
    for (const name of files) {
      const path = join(agents_dir, name);
      const raw = (await readFile(path, "utf-8")).trim();
      if (!raw) continue;
      chunks.push(`## ${name}\n${raw}`);
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

  private async _load_recent_daily_history(limit_days: number): Promise<string> {
    const files = (await this.memory_store.list_daily())
      .map((f) => f.slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, Math.max(0, limit_days));
    if (files.length === 0) return "";
    const chunks: string[] = [];
    for (const day of files) {
      const raw = (await this.memory_store.read_daily(day)).trim();
      if (!raw) continue;
      chunks.push(`### ${day}\n${raw}`);
    }
    return chunks.join("\n\n");
  }

  private _to_image_data_uri_if_local(path_or_url: string): string | null {
    const raw = String(path_or_url || "").trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return null;
    if (/^data:/i.test(raw)) return raw;
    const ext = extname(raw).toLowerCase();
    const mime = this._image_mime_from_ext(ext);
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

  private _image_mime_from_ext(ext: string): string | null {
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".bmp") return "image/bmp";
    if (ext === ".svg") return "image/svg+xml";
    return null;
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

  attach_memory(agentId: string, memory: Record<string, unknown>): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    if (!prev) return null;
    const next: AgentContextSnapshot = {
      ...prev,
      memory: { ...(prev.memory || {}), ...memory },
      updatedAt: now_iso(),
    };
    this.snapshots.set(agentId, next);
    return next;
  }

  attach_skills(agentId: string, skills: string[]): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    if (!prev) return null;
    const next: AgentContextSnapshot = {
      ...prev,
      skills: [...new Set([...(prev.skills || []), ...skills])],
      updatedAt: now_iso(),
    };
    this.snapshots.set(agentId, next);
    return next;
  }

  attach_tools(agentId: string, tools: string[]): AgentContextSnapshot | null {
    const prev = this.snapshots.get(agentId);
    if (!prev) return null;
    const next: AgentContextSnapshot = {
      ...prev,
      tools: [...new Set([...(prev.tools || []), ...tools])],
      updatedAt: now_iso(),
    };
    this.snapshots.set(agentId, next);
    return next;
  }

}
