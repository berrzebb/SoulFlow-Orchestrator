import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";

// ── Types ──

interface AgentDef {
  agent_id: string;
  role: string;
  label: string;
  backend: string;
  model?: string;
  system_prompt: string;
  tools?: string[];
  max_turns?: number;
}

interface CriticDef {
  backend: string;
  model?: string;
  system_prompt: string;
  gate: boolean;
  on_rejection?: string;
  max_retries?: number;
}

interface PhaseDef {
  phase_id: string;
  title: string;
  agents: AgentDef[];
  critic?: CriticDef;
  context_template?: string;
  failure_policy?: string;
}

interface WorkflowDef {
  title: string;
  objective: string;
  variables?: Record<string, string>;
  phases: PhaseDef[];
}

const BACKENDS = ["claude_cli", "codex_cli", "gemini_cli", "openrouter"];
const REJECTION_POLICIES = ["retry_all", "retry_targeted", "escalate"];

function empty_agent(index: number): AgentDef {
  return { agent_id: `agent-${index + 1}`, role: "", label: "", backend: "openrouter", system_prompt: "", max_turns: 3 };
}

function empty_phase(index: number): PhaseDef {
  return { phase_id: `phase-${index + 1}`, title: "", agents: [empty_agent(0)] };
}

function empty_workflow(): WorkflowDef {
  return { title: "", objective: "{{objective}}", phases: [empty_phase(0)] };
}

// ── Page ──

export default function WorkflowBuilderPage() {
  const { name } = useParams<{ name: string }>();
  const isNew = !name || name === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();

  const [tab, setTab] = useState<"builder" | "yaml">("builder");
  const [workflow, setWorkflow] = useState<WorkflowDef>(empty_workflow);
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [templateName, setTemplateName] = useState(name || "");

  // 기존 템플릿 로드
  const { data: existing } = useQuery<WorkflowDef>({
    queryKey: ["workflow-template", name],
    queryFn: () => api.get(`/api/workflow-templates/${encodeURIComponent(name!)}`),
    enabled: !isNew,
  });

  useEffect(() => {
    if (existing) {
      setWorkflow(existing);
      setTemplateName(name || existing.title);
    }
  }, [existing, name]);

  // YAML ↔ 폼 동기화
  const sync_yaml_from_form = useCallback(() => {
    try {
      setYamlText(JSON.stringify(workflow, null, 2));
      setYamlError("");
    } catch { /* ignore */ }
  }, [workflow]);

  const sync_form_from_yaml = useCallback(() => {
    try {
      const parsed = JSON.parse(yamlText) as WorkflowDef;
      if (!parsed.title || !Array.isArray(parsed.phases)) {
        setYamlError("Invalid: title and phases required");
        return false;
      }
      setWorkflow(parsed);
      setYamlError("");
      return true;
    } catch (e) {
      setYamlError(String(e));
      return false;
    }
  }, [yamlText]);

  const handleTabSwitch = (newTab: "builder" | "yaml") => {
    if (newTab === "yaml" && tab === "builder") sync_yaml_from_form();
    if (newTab === "builder" && tab === "yaml") {
      if (!sync_form_from_yaml()) return;
    }
    setTab(newTab);
  };

  // 저장
  const saveMut = useMutation({
    mutationFn: (data: { name: string; def: WorkflowDef }) =>
      api.put<{ ok: boolean; name: string }>(`/api/workflow-templates/${encodeURIComponent(data.name)}`, data.def),
    onSuccess: (result) => {
      toast(t("workflows.template_saved"));
      qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      if (isNew && result.name) navigate(`/workflows/templates/${encodeURIComponent(result.name)}`, { replace: true });
    },
    onError: () => toast("Save failed"),
  });

  const handleSave = () => {
    if (tab === "yaml" && !sync_form_from_yaml()) return;
    const slug = templateName || workflow.title || "untitled";
    saveMut.mutate({ name: slug, def: workflow });
  };

  // 실행
  const runMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean; workflow_id?: string }>("/api/workflows", body),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) navigate(`/workflows/${data.workflow_id}`);
    },
  });

  const handleRun = () => {
    if (tab === "yaml" && !sync_form_from_yaml()) return;
    runMut.mutate({ title: workflow.title, objective: workflow.objective, phases: workflow.phases });
  };

  return (
    <div className="page">
      {/* 헤더 */}
      <div className="section-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn--sm" onClick={() => navigate("/workflows/templates")}>
            ← {t("workflows.back")}
          </button>
          <input
            className="input"
            style={{ width: 260, fontWeight: 600 }}
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("workflows.template_name")}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--sm btn--accent" onClick={handleSave} disabled={saveMut.isPending}>
            {t("workflows.save_template")}
          </button>
          <button className="btn btn--sm" onClick={handleRun} disabled={runMut.isPending}>
            {t("workflows.run_template")}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="builder-tabs">
        <button className={`builder-tab${tab === "builder" ? " active" : ""}`} onClick={() => handleTabSwitch("builder")}>
          {t("workflows.builder_tab")}
        </button>
        <button className={`builder-tab${tab === "yaml" ? " active" : ""}`} onClick={() => handleTabSwitch("yaml")}>
          {t("workflows.yaml_tab")}
        </button>
      </div>

      {tab === "builder" ? (
        <FormBuilder workflow={workflow} onChange={setWorkflow} />
      ) : (
        <YamlEditor
          value={yamlText}
          onChange={setYamlText}
          error={yamlError}
          workflow={workflow}
        />
      )}
    </div>
  );
}

// ── YAML 에디터 탭 ──

function YamlEditor({ value, onChange, error, workflow }: {
  value: string;
  onChange: (v: string) => void;
  error: string;
  workflow: WorkflowDef;
}) {
  const t = useT();
  return (
    <div className="yaml-editor-layout">
      <div className="yaml-editor-pane">
        <textarea
          className="input code-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        {error && <div className="yaml-error">{error}</div>}
      </div>
      <div className="yaml-preview-pane">
        <h4 style={{ margin: "0 0 8px" }}>{t("workflows.preview")}</h4>
        <WorkflowPreview workflow={workflow} />
      </div>
    </div>
  );
}

// ── 미리보기 ──

function WorkflowPreview({ workflow }: { workflow: WorkflowDef }) {
  const t = useT();
  return (
    <div className="wf-preview">
      <div className="wf-preview__title">{workflow.title || "(untitled)"}</div>
      {workflow.phases.map((phase, pi) => (
        <div key={phase.phase_id} className="wf-preview__phase">
          <div className="wf-preview__phase-title">
            Phase {pi + 1}: {phase.title || phase.phase_id}
          </div>
          {phase.agents.map((agent, ai) => (
            <div key={agent.agent_id} className="wf-preview__agent">
              {ai < phase.agents.length - 1 ? "├─" : "└─"} {agent.label || agent.agent_id} ({agent.backend})
            </div>
          ))}
          {phase.critic && (
            <div className="wf-preview__critic">
              └─ {t("workflows.critic")}: gate={phase.critic.gate ? "true" : "false"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── 폼 빌더 탭 ──

function FormBuilder({ workflow, onChange }: { workflow: WorkflowDef; onChange: (w: WorkflowDef) => void }) {
  const t = useT();

  const update = (patch: Partial<WorkflowDef>) => onChange({ ...workflow, ...patch });

  const updatePhase = (index: number, patch: Partial<PhaseDef>) => {
    const phases = [...workflow.phases];
    phases[index] = { ...phases[index], ...patch };
    update({ phases });
  };

  const addPhase = () => update({ phases: [...workflow.phases, empty_phase(workflow.phases.length)] });

  const removePhase = (index: number) => {
    const phases = workflow.phases.filter((_, i) => i !== index);
    update({ phases });
  };

  const updateAgent = (phaseIndex: number, agentIndex: number, patch: Partial<AgentDef>) => {
    const phases = [...workflow.phases];
    const agents = [...phases[phaseIndex].agents];
    agents[agentIndex] = { ...agents[agentIndex], ...patch };
    phases[phaseIndex] = { ...phases[phaseIndex], agents };
    update({ phases });
  };

  const addAgent = (phaseIndex: number) => {
    const phases = [...workflow.phases];
    phases[phaseIndex] = {
      ...phases[phaseIndex],
      agents: [...phases[phaseIndex].agents, empty_agent(phases[phaseIndex].agents.length)],
    };
    update({ phases });
  };

  const removeAgent = (phaseIndex: number, agentIndex: number) => {
    const phases = [...workflow.phases];
    phases[phaseIndex] = {
      ...phases[phaseIndex],
      agents: phases[phaseIndex].agents.filter((_, i) => i !== agentIndex),
    };
    update({ phases });
  };

  const toggleCritic = (phaseIndex: number) => {
    const phases = [...workflow.phases];
    phases[phaseIndex] = {
      ...phases[phaseIndex],
      critic: phases[phaseIndex].critic
        ? undefined
        : { backend: "openrouter", system_prompt: "", gate: true },
    };
    update({ phases });
  };

  const updateCritic = (phaseIndex: number, patch: Partial<CriticDef>) => {
    const phases = [...workflow.phases];
    if (!phases[phaseIndex].critic) return;
    phases[phaseIndex] = {
      ...phases[phaseIndex],
      critic: { ...phases[phaseIndex].critic!, ...patch },
    };
    update({ phases });
  };

  return (
    <div className="form-builder">
      {/* 워크플로우 메타 */}
      <div className="builder-section">
        <div className="builder-row">
          <label className="label">{t("workflows.title_label")}</label>
          <input className="input" value={workflow.title} onChange={(e) => update({ title: e.target.value })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.objective_label")}</label>
          <input className="input" value={workflow.objective} onChange={(e) => update({ objective: e.target.value })} />
        </div>
      </div>

      {/* Phase 목록 */}
      {workflow.phases.map((phase, pi) => (
        <div key={pi} className="builder-phase">
          <div className="builder-phase__header">
            <h4>Phase {pi + 1}</h4>
            <button className="btn btn--sm btn--danger" onClick={() => removePhase(pi)} disabled={workflow.phases.length <= 1}>
              {t("workflows.remove_phase")}
            </button>
          </div>

          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.phase_id")}</label>
              <input className="input" value={phase.phase_id} onChange={(e) => updatePhase(pi, { phase_id: e.target.value })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.phase_title")}</label>
              <input className="input" value={phase.title} onChange={(e) => updatePhase(pi, { title: e.target.value })} />
            </div>
          </div>

          {/* Agent 목록 */}
          {phase.agents.map((agent, ai) => (
            <div key={ai} className="builder-agent">
              <div className="builder-agent__header">
                <span className="builder-agent__label">{agent.label || agent.agent_id || `Agent ${ai + 1}`}</span>
                <button className="btn btn--xs btn--danger" onClick={() => removeAgent(pi, ai)} disabled={phase.agents.length <= 1}>
                  ✕
                </button>
              </div>
              <div className="builder-row-triple">
                <div className="builder-row">
                  <label className="label">{t("workflows.agent_id")}</label>
                  <input className="input input--sm" value={agent.agent_id} onChange={(e) => updateAgent(pi, ai, { agent_id: e.target.value })} />
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.agent_role")}</label>
                  <input className="input input--sm" value={agent.role} onChange={(e) => updateAgent(pi, ai, { role: e.target.value })} />
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.agent_label")}</label>
                  <input className="input input--sm" value={agent.label} onChange={(e) => updateAgent(pi, ai, { label: e.target.value })} />
                </div>
              </div>
              <div className="builder-row-triple">
                <div className="builder-row">
                  <label className="label">{t("workflows.backend")}</label>
                  <select className="input input--sm" value={agent.backend} onChange={(e) => updateAgent(pi, ai, { backend: e.target.value })}>
                    {BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.model")}</label>
                  <input className="input input--sm" value={agent.model || ""} onChange={(e) => updateAgent(pi, ai, { model: e.target.value || undefined })} />
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.max_turns")}</label>
                  <input className="input input--sm" type="number" min={1} value={agent.max_turns || 3} onChange={(e) => updateAgent(pi, ai, { max_turns: Number(e.target.value) })} />
                </div>
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.system_prompt")}</label>
                <textarea className="input" rows={3} value={agent.system_prompt} onChange={(e) => updateAgent(pi, ai, { system_prompt: e.target.value })} />
              </div>
            </div>
          ))}

          <button className="btn btn--sm" onClick={() => addAgent(pi)}>
            + {t("workflows.add_agent")}
          </button>

          {/* Critic */}
          <div className="builder-critic-toggle">
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={!!phase.critic} onChange={() => toggleCritic(pi)} />
              {t("workflows.enable_critic")}
            </label>
          </div>

          {phase.critic && (
            <div className="builder-critic">
              <div className="builder-row-triple">
                <div className="builder-row">
                  <label className="label">{t("workflows.backend")}</label>
                  <select className="input input--sm" value={phase.critic.backend} onChange={(e) => updateCritic(pi, { backend: e.target.value })}>
                    {BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.critic_gate")}</label>
                  <select className="input input--sm" value={phase.critic.gate ? "true" : "false"} onChange={(e) => updateCritic(pi, { gate: e.target.value === "true" })}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.on_rejection")}</label>
                  <select className="input input--sm" value={phase.critic.on_rejection || ""} onChange={(e) => updateCritic(pi, { on_rejection: e.target.value || undefined })}>
                    <option value="">-</option>
                    {REJECTION_POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.system_prompt")}</label>
                <textarea className="input" rows={3} value={phase.critic.system_prompt} onChange={(e) => updateCritic(pi, { system_prompt: e.target.value })} />
              </div>
            </div>
          )}
        </div>
      ))}

      <button className="btn btn--sm btn--accent" onClick={addPhase} style={{ marginTop: 8 }}>
        + {t("workflows.add_phase")}
      </button>
    </div>
  );
}
