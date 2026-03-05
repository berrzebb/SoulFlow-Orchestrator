import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import { api } from "../../api/client";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { GraphEditor, type WorkflowDef as GraphWorkflowDef } from "./graph-editor";

interface RolePreset {
  id: string;
  name: string;
  description: string;
  soul: string | null;
  heart: string | null;
  tools: string[];
}

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
  mode?: "parallel" | "interactive" | "sequential_loop";
  max_loop_iterations?: number;
  loop_until?: string;
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

  const [tab, setTab] = useState<"graph" | "builder" | "yaml">("graph");
  const [workflow, setWorkflow] = useState<WorkflowDef>(empty_workflow);
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [templateName, setTemplateName] = useState(name || "");
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [editPhaseId, setEditPhaseId] = useState<string | null>(null);
  const [yamlSideOpen, setYamlSideOpen] = useState(false);

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
      try { setYamlText(yaml.dump(existing, { lineWidth: -1, noRefs: true })); } catch { /* ignore */ }
    }
  }, [existing, name]);

  // YAML ↔ 폼 동기화
  const sync_yaml_from_form = useCallback(() => {
    try {
      setYamlText(yaml.dump(workflow, { lineWidth: -1, noRefs: true }));
      setYamlError("");
    } catch { /* ignore */ }
  }, [workflow]);

  const sync_form_from_yaml = useCallback(() => {
    try {
      const parsed = yaml.load(yamlText) as WorkflowDef;
      if (!parsed || typeof parsed !== "object" || !parsed.title || !Array.isArray(parsed.phases)) {
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

  const handleTabSwitch = (newTab: "graph" | "builder" | "yaml") => {
    if (newTab === "yaml" && tab !== "yaml") sync_yaml_from_form();
    if (newTab !== "yaml" && tab === "yaml") {
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
      if (isNew && result.name) navigate(`/workflows/edit/${encodeURIComponent(result.name)}`, { replace: true });
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
          <button className="btn btn--sm" onClick={() => navigate("/workflows")}>
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
        <button className={`builder-tab${tab === "graph" ? " active" : ""}`} onClick={() => handleTabSwitch("graph")}>
          {t("workflows.graph_tab")}
        </button>
        <button className={`builder-tab${tab === "builder" ? " active" : ""}`} onClick={() => handleTabSwitch("builder")}>
          {t("workflows.builder_tab")}
        </button>
        <button className={`builder-tab${tab === "yaml" ? " active" : ""}`} onClick={() => handleTabSwitch("yaml")}>
          {t("workflows.yaml_tab")}
        </button>
        {tab === "graph" && (
          <button
            className={`builder-tab builder-tab--yaml-toggle${yamlSideOpen ? " active" : ""}`}
            onClick={() => { if (!yamlSideOpen) sync_yaml_from_form(); setYamlSideOpen(!yamlSideOpen); }}
            title="Toggle YAML panel"
          >
            {yamlSideOpen ? "◀" : "▶"} YAML
          </button>
        )}
      </div>

      {tab === "graph" ? (
        <div className="graph-layout">
          {/* 왼쪽 접이식 YAML 패널 */}
          <div className={`graph-layout__yaml-side${yamlSideOpen ? " open" : ""}`}>
            <div className="graph-layout__yaml-side-header">
              <span>YAML</span>
              <button className="btn btn--xs" onClick={() => setYamlSideOpen(false)} aria-label="Close">✕</button>
            </div>
            <textarea
              className="input code-textarea"
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              onBlur={() => sync_form_from_yaml()}
              spellCheck={false}
            />
            {yamlError && <div className="yaml-error">{yamlError}</div>}
          </div>
          {/* 메인 그래프 영역 */}
          <div className="graph-layout__main">
            <GraphEditor
              workflow={workflow as GraphWorkflowDef}
              onChange={(w) => setWorkflow(w as WorkflowDef)}
              selectedPhaseId={selectedPhaseId}
              onSelectPhase={setSelectedPhaseId}
              onEditPhase={setEditPhaseId}
            />
          </div>
          {editPhaseId && (
            <PhaseEditModal
              workflow={workflow}
              phaseId={editPhaseId}
              onChange={setWorkflow}
              onClose={() => setEditPhaseId(null)}
            />
          )}
        </div>
      ) : tab === "builder" ? (
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
            {phase.mode && phase.mode !== "parallel" && (
              <span className="wf-preview__mode-badge">{phase.mode === "interactive" ? "🔄 Interactive" : "🔁 Loop"}</span>
            )}
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

// ── Phase 편집 모달 ──

function PhaseEditModal({ workflow, phaseId, onChange, onClose }: {
  workflow: WorkflowDef;
  phaseId: string;
  onChange: (w: WorkflowDef) => void;
  onClose: () => void;
}) {
  const t = useT();
  const pi = workflow.phases.findIndex((p) => p.phase_id === phaseId);
  if (pi < 0) return null;
  const phase = workflow.phases[pi]!;

  const updatePhase = (patch: Partial<PhaseDef>) => {
    const phases = [...workflow.phases];
    phases[pi] = { ...phases[pi]!, ...patch } as PhaseDef;
    onChange({ ...workflow, phases });
  };

  const removePhase = () => {
    onChange({ ...workflow, phases: workflow.phases.filter((_, i) => i !== pi) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal__header">
          <h3 className="modal__title">{phase.title || phase.phase_id}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_id")}</label>
            <input className="input input--sm" value={phase.phase_id} onChange={(e) => updatePhase({ phase_id: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_title")}</label>
            <input className="input input--sm" value={phase.title} onChange={(e) => updatePhase({ title: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_mode")}</label>
            <select
              className="input input--sm"
              value={phase.mode || "parallel"}
              onChange={(e) => updatePhase({ mode: e.target.value as PhaseDef["mode"] })}
            >
              <option value="parallel">{t("workflows.mode_parallel")}</option>
              <option value="interactive">{t("workflows.mode_interactive")}</option>
              <option value="sequential_loop">{t("workflows.mode_sequential_loop")}</option>
            </select>
          </div>
          {(phase.mode === "interactive" || phase.mode === "sequential_loop") && (
            <div className="builder-row">
              <label className="label">{t("workflows.max_loop_iterations")}</label>
              <input
                className="input input--sm"
                type="number"
                min={1}
                value={phase.max_loop_iterations ?? (phase.mode === "interactive" ? 20 : 50)}
                onChange={(e) => updatePhase({ max_loop_iterations: Number(e.target.value) || undefined })}
              />
            </div>
          )}
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
            {phase.agents.length} agent{phase.agents.length !== 1 ? "s" : ""}
            {phase.critic ? " + critic" : ""}
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={removePhase} disabled={workflow.phases.length <= 1}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm" onClick={onClose}>
            {t("workflows.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 폼 빌더 탭 ──

function FormBuilder({ workflow, onChange }: { workflow: WorkflowDef; onChange: (w: WorkflowDef) => void }) {
  const t = useT();

  const { data: roles } = useQuery<RolePreset[]>({
    queryKey: ["workflow-roles"],
    queryFn: () => api.get("/api/workflow-roles"),
  });

  const update = (patch: Partial<WorkflowDef>) => onChange({ ...workflow, ...patch });

  const updatePhase = (index: number, patch: Partial<PhaseDef>) => {
    const phases = [...workflow.phases];
    phases[index] = { ...phases[index]!, ...patch } as PhaseDef;
    update({ phases });
  };

  const addPhase = () => update({ phases: [...workflow.phases, empty_phase(workflow.phases.length)] });

  const removePhase = (index: number) => {
    const phases = workflow.phases.filter((_, i) => i !== index);
    update({ phases });
  };

  const updateAgent = (phaseIndex: number, agentIndex: number, patch: Partial<AgentDef>) => {
    const phases = [...workflow.phases];
    const p = phases[phaseIndex]!;
    const agents = [...p.agents];
    agents[agentIndex] = { ...agents[agentIndex]!, ...patch } as AgentDef;
    phases[phaseIndex] = { ...p, agents };
    update({ phases });
  };

  const applyRole = (phaseIndex: number, agentIndex: number, roleId: string) => {
    const preset = roles?.find((r) => r.id === roleId);
    if (!preset) {
      updateAgent(phaseIndex, agentIndex, { role: roleId });
      return;
    }
    const prompt_parts: string[] = [];
    if (preset.soul) prompt_parts.push(preset.soul);
    if (preset.heart) prompt_parts.push(preset.heart);
    updateAgent(phaseIndex, agentIndex, {
      role: preset.id,
      label: preset.name,
      system_prompt: prompt_parts.join("\n\n") || "",
      tools: preset.tools.length > 0 ? preset.tools : undefined,
    });
  };

  const addAgent = (phaseIndex: number) => {
    const phases = [...workflow.phases];
    const p = phases[phaseIndex]!;
    phases[phaseIndex] = { ...p, agents: [...p.agents, empty_agent(p.agents.length)] };
    update({ phases });
  };

  const removeAgent = (phaseIndex: number, agentIndex: number) => {
    const phases = [...workflow.phases];
    const p = phases[phaseIndex]!;
    phases[phaseIndex] = { ...p, agents: p.agents.filter((_, i) => i !== agentIndex) };
    update({ phases });
  };

  const toggleCritic = (phaseIndex: number) => {
    const phases = [...workflow.phases];
    const p = phases[phaseIndex]!;
    phases[phaseIndex] = { ...p, critic: p.critic ? undefined : { backend: "openrouter", system_prompt: "", gate: true } };
    update({ phases });
  };

  const updateCritic = (phaseIndex: number, patch: Partial<CriticDef>) => {
    const phases = [...workflow.phases];
    const p = phases[phaseIndex]!;
    if (!p.critic) return;
    phases[phaseIndex] = { ...p, critic: { ...p.critic, ...patch } };
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

          {/* Phase 실행 모드 */}
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.phase_mode")}</label>
              <select
                className="input"
                value={phase.mode || "parallel"}
                onChange={(e) => updatePhase(pi, { mode: e.target.value as PhaseDef["mode"] })}
              >
                <option value="parallel">{t("workflows.mode_parallel")}</option>
                <option value="interactive">{t("workflows.mode_interactive")}</option>
                <option value="sequential_loop">{t("workflows.mode_sequential_loop")}</option>
              </select>
            </div>
            {(phase.mode === "interactive" || phase.mode === "sequential_loop") && (
              <div className="builder-row">
                <label className="label">{t("workflows.max_loop_iterations")}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={phase.max_loop_iterations ?? (phase.mode === "interactive" ? 20 : 50)}
                  onChange={(e) => updatePhase(pi, { max_loop_iterations: Number(e.target.value) || undefined })}
                />
              </div>
            )}
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
                  <label className="label">{t("workflows.select_role")}</label>
                  <select
                    className="input input--sm"
                    value={roles?.some((r) => r.id === agent.role) ? agent.role : ""}
                    onChange={(e) => {
                      if (e.target.value) applyRole(pi, ai, e.target.value);
                    }}
                  >
                    <option value="">{t("workflows.custom_role")}</option>
                    {roles?.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.agent_label")}</label>
                  <input className="input input--sm" value={agent.label} onChange={(e) => updateAgent(pi, ai, { label: e.target.value })} />
                </div>
              </div>
              {/* role 직접 입력 (프리셋 미선택 시) */}
              {!roles?.some((r) => r.id === agent.role) && (
                <div className="builder-row">
                  <label className="label">{t("workflows.agent_role")}</label>
                  <input className="input input--sm" value={agent.role} onChange={(e) => updateAgent(pi, ai, { role: e.target.value })} />
                </div>
              )}
              {roles?.some((r) => r.id === agent.role) && (
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", marginBottom: 8 }}>
                  {t("workflows.role_auto_prompt")}
                </div>
              )}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      className="input input--sm"
                      type="number"
                      min={0}
                      value={agent.max_turns ?? 3}
                      onChange={(e) => updateAgent(pi, ai, { max_turns: Number(e.target.value) })}
                      disabled={agent.max_turns === 0}
                      style={{ flex: 1 }}
                    />
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--fs-xs)", whiteSpace: "nowrap", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={agent.max_turns === 0}
                        onChange={(e) => updateAgent(pi, ai, { max_turns: e.target.checked ? 0 : 10 })}
                      />
                      {t("workflows.unlimited")}
                    </label>
                  </div>
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
