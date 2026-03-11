import { useState, useEffect } from "react";
import { FormModal } from "../../components/modal";
import { FormGroup } from "../../components/form-group";
import { useT } from "../../i18n";
import { api } from "../../api/client";
import { useAsyncState } from "../../hooks/use-async-state";
import type { AgentDefinition, CreateAgentDefinitionInput, UpdateAgentDefinitionInput, GeneratedAgentFields } from "../../../../src/agent/agent-definition.types";

/** 에이전트 모달 모드 — 신규, 편집, 빌트인 포크 */
export type AgentModalMode =
  | { kind: "add" }
  | { kind: "edit"; definition: AgentDefinition }
  | { kind: "fork"; definition: AgentDefinition };

interface AgentModalProps {
  mode: AgentModalMode;
  onClose: () => void;
  onSaved: () => void;
}

const SHARED_PROTOCOLS = [
  "clarification-protocol",
  "phase-gates",
  "error-escalation",
  "session-metrics",
  "difficulty-guide",
] as const;

const ROLE_SKILLS = [
  "", // 커스텀 역할 (없음)
  "role:concierge",
  "role:pm",
  "role:pl",
  "role:implementer",
  "role:reviewer",
  "role:debugger",
  "role:validator",
  "role:generalist",
];

/** 초기 폼 상태 */
function init_form(mode: AgentModalMode) {
  const src = mode.kind !== "add" ? mode.definition : null;
  return {
    name: src?.name ?? "",
    description: src?.description ?? "",
    icon: src?.icon ?? "🤖",
    role_skill: src?.role_skill ?? "",
    soul: src?.soul ?? "",
    heart: src?.heart ?? "",
    tools: src?.tools.join(", ") ?? "",
    shared_protocols: src?.shared_protocols ?? ["clarification-protocol", "phase-gates"],
    skills: src?.skills.join(", ") ?? "",
    use_when: src?.use_when ?? "",
    not_use_for: src?.not_use_for ?? "",
    extra_instructions: src?.extra_instructions ?? "",
    preferred_providers: src?.preferred_providers.join(", ") ?? "",
    model: src?.model ?? "",
    is_builtin: false,
  };
}

export function AgentModal({ mode, onClose, onSaved }: AgentModalProps) {
  const t = useT();
  const is_edit = mode.kind === "edit";
  const title = is_edit ? t("agents.edit_title") : mode.kind === "fork" ? t("agents.fork_title") : t("agents.add_title");

  const [tab, setTab] = useState<"manual" | "ai">("manual");
  const [aiPrompt, setAiPrompt] = useState("");
  const { pending: generating, run: runGenerate } = useAsyncState();
  const { pending: saving, run: runSave } = useAsyncState();

  const [form, setForm] = useState(() => init_form(mode));

  useEffect(() => {
    setForm(init_form(mode));
    setAiPrompt("");
    setTab("manual");
  }, [mode]);

  const set = <K extends keyof typeof form>(key: K, value: typeof form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggle_protocol = (protocol: string) => {
    set("shared_protocols", form.shared_protocols.includes(protocol)
      ? form.shared_protocols.filter((p) => p !== protocol)
      : [...form.shared_protocols, protocol]);
  };

  async function handle_generate() {
    if (!aiPrompt.trim()) return;
    await runGenerate(async () => {
      const data = await api.post<GeneratedAgentFields>("/api/agent-definitions/generate", { prompt: aiPrompt });
      setForm((f) => ({
        ...f,
        name: data.name || f.name,
        description: data.description || f.description,
        icon: data.icon || f.icon,
        role_skill: data.role_skill || f.role_skill,
        soul: data.soul || f.soul,
        heart: data.heart || f.heart,
        tools: data.tools?.join(", ") || f.tools,
        shared_protocols: data.shared_protocols?.length ? data.shared_protocols : f.shared_protocols,
        skills: data.skills?.join(", ") || f.skills,
        use_when: data.use_when || f.use_when,
        not_use_for: data.not_use_for || f.not_use_for,
        extra_instructions: data.extra_instructions || f.extra_instructions,
        preferred_providers: data.preferred_providers?.join(", ") || f.preferred_providers,
        model: data.model || f.model,
      }));
      setTab("manual");
    });
  }

  async function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    await runSave(async () => {
      const payload: CreateAgentDefinitionInput | UpdateAgentDefinitionInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon.trim() || "🤖",
        role_skill: form.role_skill || null,
        soul: form.soul.trim(),
        heart: form.heart.trim(),
        tools: form.tools.split(",").map((s) => s.trim()).filter(Boolean),
        shared_protocols: form.shared_protocols,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        use_when: form.use_when.trim(),
        not_use_for: form.not_use_for.trim(),
        extra_instructions: form.extra_instructions.trim(),
        preferred_providers: form.preferred_providers.split(",").map((s) => s.trim()).filter(Boolean),
        model: form.model.trim() || null,
        is_builtin: false,
      };

      if (is_edit) {
        await api.put(`/api/agent-definitions/${(mode as { kind: "edit"; definition: AgentDefinition }).definition.id}`, payload);
      } else {
        await api.post("/api/agent-definitions", payload);
      }
      onSaved();
    });
  }

  return (
    <FormModal
      open
      title={title}
      onClose={onClose}
      onSubmit={handle_submit}
      submitLabel={saving ? t("common.saving") : t("common.save")}
      saving={saving}
      wide
    >
      {/* AI 생성 탭 */}
      <div className="provider-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "manual"} className={`provider-tab${tab === "manual" ? " provider-tab--active" : ""}`} onClick={() => setTab("manual")}>
          {t("agents.tab_manual")}
        </button>
        <button role="tab" aria-selected={tab === "ai"} className={`provider-tab${tab === "ai" ? " provider-tab--active" : ""}`} onClick={() => setTab("ai")}>
          ✨ {t("agents.tab_ai")}
        </button>
      </div>

      {tab === "ai" && (
        <div className="form-section">
          <FormGroup label={t("agents.ai_prompt_label")}>
            <textarea
              className="input input--md"
              rows={3}
              placeholder={t("agents.ai_prompt_placeholder")}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
          </FormGroup>
          <button
            type="button"
            className="btn btn--accent btn--sm"
            disabled={generating || !aiPrompt.trim()}
            onClick={() => void handle_generate()}
          >
            {generating ? t("agents.generating") : t("agents.generate")}
          </button>
          {generating && <p className="form-hint">{t("agents.generating_hint")}</p>}
        </div>
      )}

      {/* ① 기본 정보 */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_basic")}</legend>
        <div className="form-row">
          <FormGroup label={t("agents.icon")} style={{ flex: "0 0 64px" }}>
            <input className="input input--center" value={form.icon} onChange={(e) => set("icon", e.target.value)} maxLength={4} placeholder="🤖" />
          </FormGroup>
          <FormGroup label={t("agents.name")} required style={{ flex: 1 }}>
            <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("agents.name_placeholder")} required />
          </FormGroup>
        </div>
        <FormGroup label={t("agents.description")}>
          <input className="input" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={t("agents.description_placeholder")} />
        </FormGroup>
      </fieldset>

      {/* ② 역할 (Role Skill) */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_role")}</legend>
        <FormGroup label={t("agents.role_skill")}>
          <select className="input" value={form.role_skill} onChange={(e) => set("role_skill", e.target.value)}>
            {ROLE_SKILLS.map((r) => (
              <option key={r} value={r}>{r || t("agents.role_custom")}</option>
            ))}
          </select>
        </FormGroup>
        <FormGroup label={t("agents.soul")}>
          <textarea className="input" rows={2} value={form.soul} onChange={(e) => set("soul", e.target.value)} placeholder={t("agents.soul_placeholder")} />
        </FormGroup>
        <FormGroup label={t("agents.heart")}>
          <textarea className="input" rows={2} value={form.heart} onChange={(e) => set("heart", e.target.value)} placeholder={t("agents.heart_placeholder")} />
        </FormGroup>
      </fieldset>

      {/* ③ 공통 규칙 (Shared Protocols) */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_protocols")}</legend>
        <div className="checkbox-grid">
          {SHARED_PROTOCOLS.map((protocol) => (
            <label key={protocol} className="checkbox-item">
              <input
                type="checkbox"
                checked={form.shared_protocols.includes(protocol)}
                onChange={() => toggle_protocol(protocol)}
              />
              <span>{protocol}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ④ 허용 도구 + 추가 스킬 */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_tools")}</legend>
        <FormGroup label={t("agents.tools")} hint={t("agents.tools_hint")}>
          <input className="input" value={form.tools} onChange={(e) => set("tools", e.target.value)} placeholder="read_file, write_file, exec" />
        </FormGroup>
        <FormGroup label={t("agents.skills")} hint={t("agents.skills_hint")}>
          <input className="input" value={form.skills} onChange={(e) => set("skills", e.target.value)} placeholder="github, cron, memory" />
        </FormGroup>
      </fieldset>

      {/* ⑤ 경계 (Boundary) */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_boundary")}</legend>
        <FormGroup label={t("agents.use_when")}>
          <input className="input" value={form.use_when} onChange={(e) => set("use_when", e.target.value)} placeholder={t("agents.use_when_placeholder")} />
        </FormGroup>
        <FormGroup label={t("agents.not_use_for")}>
          <input className="input" value={form.not_use_for} onChange={(e) => set("not_use_for", e.target.value)} placeholder={t("agents.not_use_for_placeholder")} />
        </FormGroup>
      </fieldset>

      {/* ⑥ 추가 지침 */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_extra")}</legend>
        <FormGroup label={t("agents.extra_instructions")}>
          <textarea className="input" rows={3} value={form.extra_instructions} onChange={(e) => set("extra_instructions", e.target.value)} placeholder={t("agents.extra_instructions_placeholder")} />
        </FormGroup>
      </fieldset>

      {/* ⑦ 실행 설정 */}
      <fieldset className="form-section">
        <legend className="form-section__title">{t("agents.section_execution")}</legend>
        <FormGroup label={t("agents.preferred_providers")} hint={t("agents.preferred_providers_hint")}>
          <input className="input" value={form.preferred_providers} onChange={(e) => set("preferred_providers", e.target.value)} placeholder="provider-id-1, provider-id-2" />
        </FormGroup>
        <FormGroup label={t("agents.model")}>
          <input className="input" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="claude-opus-4-6" />
        </FormGroup>
      </fieldset>
    </FormModal>
  );
}
