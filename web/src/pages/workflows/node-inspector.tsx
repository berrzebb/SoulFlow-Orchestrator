/**
 * NodeInspector — n8n 스타일 노드 인스펙션 사이드 패널.
 * Parameters 탭: registry EditPanel, Phase/Agent/Critic 내장 패널.
 * Output 탭: 실행 결과 스키마 기반 표시 + 드래그 가능 필드.
 */

import { useState, type DragEvent } from "react";
import { get_frontend_node, type NodeOptions } from "./node-registry";
import type { OutputField } from "./output-schema";
import { FIELD_TYPE_COLORS, PHASE_OUTPUT, PHASE_INPUT } from "./output-schema";
import type { PhaseDef, AgentDef, CriticDef, ToolNodeDef, SkillNodeDef, WorkflowDef } from "./workflow-types";

/** 노드 실행 상태 (PhaseLoopState.orche_states 항목). */
export interface NodeExecutionState {
  node_id: string;
  node_type: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

/** 상류 노드의 드래그 가능 출력 참조. */
export interface UpstreamRef {
  node_id: string;
  node_label: string;
  fields: OutputField[];
}

export interface NodeInspectorProps {
  /** 노드 원본 데이터 (orche_data, phase, trigger 등). */
  node: Record<string, unknown>;
  node_id: string;
  node_type: string;
  node_label: string;
  execution_state?: NodeExecutionState;
  onUpdate: (partial: Record<string, unknown>) => void;
  onClose: () => void;
  t: (key: string) => string;
  options?: NodeOptions;
  /** Phase 노드 전용: 워크플로우 + 업데이트 콜백 (sub-node 편집용). */
  workflow?: WorkflowDef;
  onWorkflowChange?: (w: WorkflowDef) => void;
  /** 이 노드에 연결된 상류 노드들의 출력 필드 목록 (드래그 참조용). */
  upstream_refs?: UpstreamRef[];
}

export function NodeInspector({
  node, node_id, node_type, node_label, execution_state,
  onUpdate, onClose, t, options, workflow, onWorkflowChange, upstream_refs,
}: NodeInspectorProps) {
  const desc = get_frontend_node(node_type);

  // Phase 노드 또는 sub-node 판별
  const isPhase = node_type === "phase";
  const isSubNode = node_type === "agent" || node_type === "critic" || node_type === "tool_sub" || node_type === "skill_sub";

  const SUB_ICON: Record<string, string> = { agent: "🤖", critic: "⚖", tool_sub: "🔧", skill_sub: "⚡" };
  const SUB_COLOR: Record<string, string> = { agent: "#3498db", critic: "#e74c3c", tool_sub: "#f39c12", skill_sub: "#2ecc71" };
  const icon = isPhase ? "⚙" : isSubNode ? (SUB_ICON[node_type] || "⚙") : (desc?.icon || "⚙");
  const color = isPhase ? "var(--accent, #89b4fa)" : isSubNode ? (SUB_COLOR[node_type] || "var(--accent)") : (desc?.color || "var(--accent, #89b4fa)");
  const EditPanel = desc?.EditPanel;
  const output_schema = isPhase ? PHASE_OUTPUT : (desc?.output_schema || []);
  const input_schema = isPhase ? PHASE_INPUT : (desc?.input_schema || []);

  // 섹션 접기 상태
  const [inputOpen, setInputOpen] = useState(true);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);

  const hasInput = input_schema.length > 0 || (upstream_refs && upstream_refs.length > 0);

  return (
    <div className="node-inspector">
      {/* 헤더 */}
      <div className="inspector-header">
        <span className="inspector-icon" style={{ color }}>{icon}</span>
        <span className="inspector-title">{node_label || node_type}</span>
        <span className="inspector-node-id">{node_id}</span>
        <button className="inspector-close" onClick={onClose} title="Close" aria-label="Close">✕</button>
      </div>

      {/* 단일 스크롤 본문: Input → Parameters → Output */}
      <div className="inspector-body">
        {/* ── Input (이 노드의 입력 스키마 + 상류 드래그 소스) ── */}
        {hasInput && (
          <div className="inspector-section-block">
            <button className="inspector-section-toggle" aria-expanded={inputOpen} onClick={() => setInputOpen(!inputOpen)}>
              <span>{inputOpen ? "▾" : "▸"} Input</span>
              <span className="inspector-section-count">{input_schema.length} fields</span>
            </button>
            {inputOpen && (
              <InputSectionPanel
                input_schema={input_schema}
                upstream_refs={upstream_refs || []}
                node_id={node_id}
                workflow={workflow}
              />
            )}
          </div>
        )}

        {/* ── Parameters ── */}
        <div className="inspector-section-block">
          <button className="inspector-section-toggle" aria-expanded={paramsOpen} onClick={() => setParamsOpen(!paramsOpen)}>
            <span>{paramsOpen ? "▾" : "▸"} Parameters</span>
          </button>
          {paramsOpen && (
            <div className="inspector-section-content">
              {isPhase && workflow && onWorkflowChange && (
                <PhaseParamsPanel
                  phase={node as unknown as PhaseDef}
                  workflow={workflow}
                  onChange={onWorkflowChange}
                  t={t}
                  options={options}
                />
              )}
              {isSubNode && workflow && onWorkflowChange && (
                <SubNodeParamsPanel
                  subNodeId={node_id}
                  subType={node_type as "agent" | "critic" | "tool_sub" | "skill_sub"}
                  workflow={workflow}
                  onChange={onWorkflowChange}
                  t={t}
                  options={options}
                />
              )}
              {!isPhase && !isSubNode && EditPanel && (
                <EditPanel node={node} update={onUpdate} t={t} options={options} />
              )}
              {!isPhase && !isSubNode && !EditPanel && (
                <div className="inspector-empty">{t("workflows.no_edit_panel") || "편집 패널 없음"}</div>
              )}
            </div>
          )}
        </div>

        {/* ── Output (이 노드의 출력 필드 — 드래그 소스 + 실행 결과) ── */}
        <div className="inspector-section-block">
          <button className="inspector-section-toggle" aria-expanded={outputOpen} onClick={() => setOutputOpen(!outputOpen)}>
            <span>{outputOpen ? "▾" : "▸"} Output</span>
            {execution_state?.status === "completed" && <span className="tab-badge tab-badge--ok">✓</span>}
            {execution_state?.status === "failed" && <span className="tab-badge tab-badge--err">✗</span>}
            {execution_state?.status === "running" && <span className="tab-badge tab-badge--run">⟳</span>}
          </button>
          {outputOpen && (
            <NodeOutputView state={execution_state} schema={output_schema} node_id={node_id} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Phase Parameters Panel ──

function PhaseParamsPanel({ phase, workflow, onChange, t, options }: {
  phase: PhaseDef;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: (key: string) => string;
  options?: NodeOptions;
}) {
  const pi = workflow.phases.findIndex((p) => p.phase_id === phase.phase_id);
  if (pi < 0) return null;

  const updatePhase = (patch: Partial<PhaseDef>) => {
    const phases = [...workflow.phases];
    phases[pi] = { ...phases[pi]!, ...patch } as PhaseDef;
    onChange({ ...workflow, phases });
  };

  const addAgent = () => {
    const agents = [...phase.agents];
    const idx = agents.length + 1;
    agents.push({
      agent_id: `agent-${idx}`,
      role: "",
      label: `Agent ${idx}`,
      backend: options?.backends?.[0]?.value || "",
      system_prompt: "",
      max_turns: 3,
    });
    updatePhase({ agents });
  };

  const toggleCritic = () => {
    if (phase.critic) {
      updatePhase({ critic: undefined });
    } else {
      updatePhase({
        critic: {
          backend: options?.backends?.[0]?.value || "",
          system_prompt: "",
          gate: true,
        },
      });
    }
  };

  return (
    <>
      {/* Phase 기본 정보 */}
      <div className="builder-row-pair">
        <div className="builder-row">
          <label className="label">Phase ID</label>
          <input className="input input--sm" value={phase.phase_id}
            onChange={(e) => updatePhase({ phase_id: e.target.value })} />
        </div>
        <div className="builder-row">
          <label className="label">{t("workflows.phase_title") || "Title"}</label>
          <input className="input input--sm" value={phase.title}
            onChange={(e) => updatePhase({ title: e.target.value })} />
        </div>
      </div>

      <div className="builder-row">
        <label className="label">{t("workflows.phase_mode") || "Mode"}</label>
        <select className="input input--sm"
          value={phase.mode || "parallel"}
          onChange={(e) => updatePhase({ mode: e.target.value as PhaseDef["mode"] })}
        >
          <option value="parallel">{t("workflows.mode_parallel") || "Parallel"}</option>
          <option value="interactive">{t("workflows.mode_interactive") || "Interactive"}</option>
          <option value="sequential_loop">{t("workflows.mode_sequential_loop") || "Sequential Loop"}</option>
        </select>
      </div>

      {(phase.mode === "interactive" || phase.mode === "sequential_loop") && (
        <div className="builder-row">
          <label className="label">{t("workflows.max_loop_iterations") || "Max Iterations"}</label>
          <input className="input input--sm" type="number" min={1}
            value={phase.max_loop_iterations ?? (phase.mode === "interactive" ? 20 : 50)}
            onChange={(e) => updatePhase({ max_loop_iterations: Number(e.target.value) || undefined })} />
        </div>
      )}

      {/* context_template */}
      <div className="builder-row">
        <label className="label">{t("workflows.context_template") || "Context Template"}</label>
        <textarea className="input input--sm inspector-droppable" rows={2}
          value={phase.context_template || ""}
          onChange={(e) => updatePhase({ context_template: e.target.value })}
          onDrop={(e) => handleFieldDrop(e, (ref) => updatePhase({ context_template: (phase.context_template || "") + ref }))}
          onDragOver={handleDragOver}
          placeholder="{{prev_phase.result}}"
          data-droppable="true"
        />
        <span className="builder-hint">{t("workflows.context_template_hint") || "이전 Phase/노드 출력을 참조할 수 있습니다. Output 필드를 여기에 드래그하세요."}</span>
      </div>

      {/* 에이전트 목록 */}
      <div className="inspector-section">
        <div className="inspector-section__header">
          <span className="inspector-section__title">
            Agents ({phase.agents.length})
          </span>
          <button className="btn btn--xs btn--accent" onClick={addAgent}>+ Agent</button>
        </div>
        {phase.agents.map((agent, ai) => (
          <AgentSummaryCard
            key={agent.agent_id}
            agent={agent}
            index={ai}
            phase={phase}
            workflow={workflow}
            onChange={onChange}
            t={t}
            options={options}
          />
        ))}
      </div>

      {/* Critic */}
      <div className="inspector-section">
        <div className="inspector-section__header">
          <span className="inspector-section__title">Critic</span>
          <button className="btn btn--xs" onClick={toggleCritic}>
            {phase.critic ? "Remove" : "+ Add"}
          </button>
        </div>
        {phase.critic && (
          <CriticSummaryCard
            critic={phase.critic}
            phase={phase}
            workflow={workflow}
            onChange={onChange}
            t={t}
            options={options}
          />
        )}
      </div>
    </>
  );
}

// ── Agent Summary Card (expandable) ──

function AgentSummaryCard({ agent, index, phase, workflow, onChange, t, options }: {
  agent: AgentDef;
  index: number;
  phase: PhaseDef;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: (key: string) => string;
  options?: NodeOptions;
}) {
  const [expanded, setExpanded] = useState(false);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phase.phase_id);

  const updateAgent = (patch: Partial<AgentDef>) => {
    const phases = [...workflow.phases];
    const agents = [...phase.agents];
    agents[index] = { ...agents[index]!, ...patch };
    phases[pi] = { ...phase, agents };
    onChange({ ...workflow, phases });
  };

  const removeAgent = () => {
    if (phase.agents.length <= 1) return;
    const phases = [...workflow.phases];
    const agents = phase.agents.filter((_, i) => i !== index);
    phases[pi] = { ...phase, agents };
    onChange({ ...workflow, phases });
  };

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">🤖</span>
        <span className="inspector-card__label">{agent.label || agent.agent_id}</span>
        <span className="inspector-card__meta">{agent.backend || "no backend"}</span>
        <span className="inspector-card__toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">Agent ID</label>
              <input className="input input--sm" value={agent.agent_id}
                onChange={(e) => updateAgent({ agent_id: e.target.value })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.agent_label") || "Label"}</label>
              <input className="input input--sm" value={agent.label}
                onChange={(e) => updateAgent({ label: e.target.value })} />
            </div>
          </div>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.backend") || "Backend"}</label>
              <select className="input input--sm" value={agent.backend}
                onChange={(e) => updateAgent({ backend: e.target.value })}>
                <option value="">-</option>
                {(options?.backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.model") || "Model"}</label>
              <input className="input input--sm" value={agent.model || ""}
                onChange={(e) => updateAgent({ model: e.target.value || undefined })}
                placeholder="auto" />
            </div>
          </div>
          <div className="builder-row">
            <label className="label">Max Turns</label>
            <input className="input input--sm" type="number" min={0}
              value={agent.max_turns ?? 3}
              onChange={(e) => updateAgent({ max_turns: Number(e.target.value) })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.system_prompt") || "System Prompt"}</label>
            <textarea className="input input--sm inspector-droppable" rows={4}
              value={agent.system_prompt}
              onChange={(e) => updateAgent({ system_prompt: e.target.value })}
              onDrop={(e) => handleFieldDrop(e, (ref) => updateAgent({ system_prompt: agent.system_prompt + ref }))}
              onDragOver={handleDragOver}
              data-droppable="true"
            />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.agent_role") || "Role"}</label>
            <input className="input input--sm" value={agent.role}
              onChange={(e) => updateAgent({ role: e.target.value })} />
          </div>
          <div className="inspector-card__actions">
            <button className="btn btn--xs btn--danger" onClick={removeAgent}
              disabled={phase.agents.length <= 1}>
              {t("workflows.remove_phase") || "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Critic Summary Card ──

function CriticSummaryCard({ critic, phase, workflow, onChange, t, options }: {
  critic: CriticDef;
  phase: PhaseDef;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: (key: string) => string;
  options?: NodeOptions;
}) {
  const [expanded, setExpanded] = useState(false);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phase.phase_id);

  const updateCritic = (patch: Partial<CriticDef>) => {
    const phases = [...workflow.phases];
    phases[pi] = { ...phase, critic: { ...critic, ...patch } };
    onChange({ ...workflow, phases });
  };

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">⚖</span>
        <span className="inspector-card__label">Critic</span>
        <span className="inspector-card__meta">gate={critic.gate ? "yes" : "no"}</span>
        <span className="inspector-card__toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">{t("workflows.backend") || "Backend"}</label>
              <select className="input input--sm" value={critic.backend}
                onChange={(e) => updateCritic({ backend: e.target.value })}>
                <option value="">-</option>
                {(options?.backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.model") || "Model"}</label>
              <input className="input input--sm" value={critic.model || ""}
                onChange={(e) => updateCritic({ model: e.target.value || undefined })}
                placeholder="auto" />
            </div>
          </div>
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">Gate</label>
              <select className="input input--sm" value={critic.gate ? "true" : "false"}
                onChange={(e) => updateCritic({ gate: e.target.value === "true" })}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.on_rejection") || "On Rejection"}</label>
              <select className="input input--sm" value={critic.on_rejection || ""}
                onChange={(e) => updateCritic({ on_rejection: e.target.value || undefined })}>
                <option value="">-</option>
                <option value="retry_all">retry_all</option>
                <option value="retry_targeted">retry_targeted</option>
                <option value="escalate">escalate</option>
              </select>
            </div>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.system_prompt") || "System Prompt"}</label>
            <textarea className="input input--sm inspector-droppable" rows={4}
              value={critic.system_prompt}
              onChange={(e) => updateCritic({ system_prompt: e.target.value })}
              onDrop={(e) => handleFieldDrop(e, (ref) => updateCritic({ system_prompt: critic.system_prompt + ref }))}
              onDragOver={handleDragOver}
              data-droppable="true"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-node (standalone agent/critic selection from graph) ──

function SubNodeParamsPanel({ subNodeId, subType, workflow, onChange, t, options }: {
  subNodeId: string;
  subType: "agent" | "critic" | "tool_sub" | "skill_sub";
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: (key: string) => string;
  options?: NodeOptions;
}) {
  // Tool sub-node: "{phaseId}__tool_{toolNodeId}"
  if (subType === "tool_sub") {
    const match = subNodeId.match(/^(.+)__tool_(.+)$/);
    if (!match) return <div className="inspector-empty">Invalid tool sub-node ID</div>;
    const toolNodeId = match[2]!;
    const nodes = workflow.tool_nodes || [];
    const idx = nodes.findIndex((n) => n.id === toolNodeId);
    if (idx < 0) return <div className="inspector-empty">Tool node not found</div>;
    return (
      <ToolParamsPanel
        node={nodes[idx]!}
        index={idx}
        workflow={workflow}
        onChange={onChange}
        t={t}
        options={options}
      />
    );
  }

  // Skill sub-node: "{phaseId}__skill_{skillNodeId}"
  if (subType === "skill_sub") {
    const match = subNodeId.match(/^(.+)__skill_(.+)$/);
    if (!match) return <div className="inspector-empty">Invalid skill sub-node ID</div>;
    const skillNodeId = match[2]!;
    const nodes = workflow.skill_nodes || [];
    const idx = nodes.findIndex((n) => n.id === skillNodeId);
    if (idx < 0) return <div className="inspector-empty">Skill node not found</div>;
    return (
      <SkillParamsPanel
        node={nodes[idx]!}
        index={idx}
        workflow={workflow}
        onChange={onChange}
        t={t}
        options={options}
      />
    );
  }

  // Agent / Critic sub-node: "{phaseId}__{agentId}" or "{phaseId}__critic"
  const sep = subNodeId.indexOf("__");
  if (sep < 0) return <div className="inspector-empty">Invalid sub-node ID</div>;
  const phaseId = subNodeId.slice(0, sep);
  const subId = subNodeId.slice(sep + 2);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phaseId);
  if (pi < 0) return <div className="inspector-empty">Phase not found</div>;
  const phase = workflow.phases[pi]!;

  if (subType === "critic" || subId === "critic") {
    if (!phase.critic) return <div className="inspector-empty">No critic</div>;
    return (
      <CriticSummaryCard
        critic={phase.critic}
        phase={phase}
        workflow={workflow}
        onChange={onChange}
        t={t}
        options={options}
      />
    );
  }

  const agentIdx = phase.agents.findIndex((a) => a.agent_id === subId);
  if (agentIdx < 0) return <div className="inspector-empty">Agent not found</div>;

  return (
    <AgentSummaryCard
      agent={phase.agents[agentIdx]!}
      index={agentIdx}
      phase={phase}
      workflow={workflow}
      onChange={onChange}
      t={t}
      options={options}
    />
  );
}

// ── Tool Parameters Panel ──

function ToolParamsPanel({ node, index, workflow, onChange, t, options }: {
  node: ToolNodeDef;
  index: number;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: (key: string) => string;
  options?: NodeOptions;
}) {
  const [expanded, setExpanded] = useState(true);
  const nodes = workflow.tool_nodes || [];

  const update = (patch: Partial<ToolNodeDef>) => {
    const updated = [...nodes];
    updated[index] = { ...node, ...patch };
    onChange({ ...workflow, tool_nodes: updated });
  };

  const remove = () => {
    onChange({ ...workflow, tool_nodes: nodes.filter((_, i) => i !== index) });
  };

  const availableTools = options?.available_tools || [];
  const toolDefinitions = options?.tool_definitions || [];
  const phaseOptions = workflow.phases.map((p) => ({ id: p.phase_id, label: p.title || p.phase_id }));

  // JSON Schema에서 파라미터 추출
  const toolDef = toolDefinitions.find((d) =>
    (d as { function?: { name?: string } }).function?.name === node.tool_id
  ) as { function?: { name?: string; parameters?: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }> } } } | undefined;
  const paramSchema = toolDef?.function?.parameters?.properties || {};
  const params = node.params || {};

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">🔧</span>
        <span className="inspector-card__label">{node.tool_id || "Tool"}</span>
        <span className="inspector-card__meta">{node.id}</span>
        <span className="inspector-card__toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <div className="builder-row">
            <label className="label">{t("workflows.tool_id") || "Tool ID"}</label>
            {availableTools.length > 0 ? (
              <select className="input input--sm" value={node.tool_id} onChange={(e) => update({ tool_id: e.target.value })}>
                <option value="">—</option>
                {availableTools.map((tid) => <option key={tid} value={tid}>{tid}</option>)}
              </select>
            ) : (
              <input className="input input--sm" value={node.tool_id}
                onChange={(e) => update({ tool_id: e.target.value })} placeholder="tool_name" />
            )}
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.description") || "Description"}</label>
            <input className="input input--sm" value={node.description}
              onChange={(e) => update({ description: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.attach_to_phases") || "Attach to Phases"}</label>
            <div className="inspector-tag-list">
              {phaseOptions.map((p) => {
                const attached = (node.attach_to || []).includes(p.id);
                return (
                  <button key={p.id}
                    className={`inspector-tag${attached ? " inspector-tag--active" : ""}`}
                    onClick={() => {
                      const next = attached
                        ? (node.attach_to || []).filter((x) => x !== p.id)
                        : [...(node.attach_to || []), p.id];
                      update({ attach_to: next });
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          {Object.keys(paramSchema).length > 0 && (
            <div className="builder-row">
              <label className="label">{t("workflows.tool_params") || "Parameters"}</label>
              <div className="builder-param-list">
                {Object.entries(paramSchema).map(([key, schema]) => (
                  <div key={key} className="builder-param-row">
                    <span className="builder-param-key" title={schema.description}>{key}</span>
                    {schema.enum ? (
                      <select className="input input--sm flex-1"
                        value={String(params[key] ?? "")}
                        onChange={(e) => update({ params: { ...params, [key]: e.target.value } })}>
                        <option value="">—</option>
                        {schema.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : schema.type === "boolean" ? (
                      <input type="checkbox" checked={!!params[key]}
                        onChange={(e) => update({ params: { ...params, [key]: e.target.checked } })} />
                    ) : (
                      <input className="input input--sm flex-1"
                        type={schema.type === "number" || schema.type === "integer" ? "number" : "text"}
                        value={String(params[key] ?? "")}
                        placeholder={schema.description}
                        onChange={(e) => update({ params: { ...params, [key]: schema.type === "number" || schema.type === "integer" ? Number(e.target.value) : e.target.value } })} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="inspector-card__actions">
            <button className="btn btn--xs btn--danger" onClick={remove}>
              {t("workflows.delete") || "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Skill Parameters Panel ──

function SkillParamsPanel({ node, index, workflow, onChange, t, options }: {
  node: SkillNodeDef;
  index: number;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: (key: string) => string;
  options?: NodeOptions;
}) {
  const [expanded, setExpanded] = useState(true);
  const nodes = workflow.skill_nodes || [];

  const update = (patch: Partial<SkillNodeDef>) => {
    const updated = [...nodes];
    updated[index] = { ...node, ...patch };
    onChange({ ...workflow, skill_nodes: updated });
  };

  const remove = () => {
    onChange({ ...workflow, skill_nodes: nodes.filter((_, i) => i !== index) });
  };

  const availableSkills = options?.available_skills || [];
  const phaseOptions = workflow.phases.map((p) => ({ id: p.phase_id, label: p.title || p.phase_id }));

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">⚡</span>
        <span className="inspector-card__label">{node.skill_name || "Skill"}</span>
        <span className="inspector-card__meta">{node.id}</span>
        <span className="inspector-card__toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <div className="builder-row">
            <label className="label">{t("workflows.skill_name") || "Skill Name"}</label>
            {availableSkills.length > 0 ? (
              <select className="input input--sm" value={node.skill_name} onChange={(e) => update({ skill_name: e.target.value })}>
                <option value="">—</option>
                {availableSkills.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input className="input input--sm" value={node.skill_name}
                onChange={(e) => update({ skill_name: e.target.value })} placeholder="skill_name" />
            )}
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.description") || "Description"}</label>
            <input className="input input--sm" value={node.description}
              onChange={(e) => update({ description: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.attach_to_phases") || "Attach to Phases"}</label>
            <div className="inspector-tag-list">
              {phaseOptions.map((p) => {
                const attached = (node.attach_to || []).includes(p.id);
                return (
                  <button key={p.id}
                    className={`inspector-tag${attached ? " inspector-tag--active" : ""}`}
                    onClick={() => {
                      const next = attached
                        ? (node.attach_to || []).filter((x) => x !== p.id)
                        : [...(node.attach_to || []), p.id];
                      update({ attach_to: next });
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="inspector-card__actions">
            <button className="btn btn--xs btn--danger" onClick={remove}>
              {t("workflows.delete") || "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Input Section: 입력 스키마 + 상류 드래그 소스 ──

function InputSectionPanel({ input_schema, upstream_refs, node_id, workflow }: {
  input_schema: OutputField[];
  upstream_refs: UpstreamRef[];
  node_id: string;
  workflow?: WorkflowDef;
}) {
  // field_mappings에서 이 노드의 입력에 매핑된 소스 찾기
  const mappings = workflow?.field_mappings || [];
  const getMappedSource = (fieldName: string) =>
    mappings.find((m) => m.to_node === node_id && m.to_field === fieldName);

  return (
    <div className="input-section">
      {/* 이 노드의 입력 필드 */}
      {input_schema.length > 0 && (
        <div className="input-schema-list">
          {input_schema.map((field) => {
            const mapped = getMappedSource(field.name);
            return (
              <div key={field.name} className="input-schema-row">
                <div className="input-schema-row__header">
                  <span className="field-name">{field.name}</span>
                  <span className="field-type" style={{ color: FIELD_TYPE_COLORS[field.type] || "#95a5a6" }}>{field.type}</span>
                </div>
                {field.description && <div className="field-description">{field.description}</div>}
                {mapped && (
                  <div className="input-schema-row__mapped">
                    {`← {{${mapped.from_node}.${mapped.from_field}}}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 상류 노드 출력 (드래그 소스) */}
      {upstream_refs.length > 0 && (
        <div className="upstream-refs-section">
          <div className="upstream-refs-section__label">Available from upstream</div>
          {upstream_refs.map((ref) => (
            <div key={ref.node_id} className="upstream-refs__group">
              <div className="upstream-refs__node-label">{ref.node_label}</div>
              {ref.fields.map((field) => (
                <div
                  key={field.name}
                  className="upstream-refs__field"
                  draggable
                  onDragStart={(e) => handleOutputFieldDragStart(e, ref.node_id, field.name)}
                >
                  <span className="field-drag-handle">⠿</span>
                  <span className="field-name">{field.name}</span>
                  <span className="field-type" style={{ color: FIELD_TYPE_COLORS[field.type] || "#95a5a6" }}>{field.type}</span>
                  <span className="field-ref-tag">{`{{${ref.node_id}.${field.name}}}`}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Output View with Draggable Fields ──

/** 출력 필드를 드래그 시작: `{{node_id.field_name}}` 텍스트를 전달. */
function handleOutputFieldDragStart(e: DragEvent, node_id: string, field_name: string) {
  const ref = `{{${node_id}.${field_name}}}`;
  e.dataTransfer.setData("text/plain", ref);
  e.dataTransfer.setData("application/x-field-ref", JSON.stringify({ node_id, field_name, ref }));
  e.dataTransfer.effectAllowed = "copy";
}

/** 드롭 타겟에서 필드 참조 수신. */
function handleFieldDrop(e: DragEvent<HTMLTextAreaElement | HTMLInputElement>, onInsert: (ref: string) => void) {
  e.preventDefault();
  const refData = e.dataTransfer.getData("application/x-field-ref");
  if (refData) {
    try {
      const { ref } = JSON.parse(refData) as { ref: string };
      // textarea인 경우 커서 위치에 삽입
      const target = e.target as HTMLTextAreaElement | HTMLInputElement;
      const start = target.selectionStart ?? target.value.length;
      const before = target.value.slice(0, start);
      const after = target.value.slice(target.selectionEnd ?? start);
      const newVal = before + ref + after;
      // React controlled component → synthetic event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(target, newVal);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        onInsert(ref);
      }
    } catch {
      const plain = e.dataTransfer.getData("text/plain");
      if (plain) onInsert(plain);
    }
  }
}

function handleDragOver(e: DragEvent<HTMLTextAreaElement | HTMLInputElement>) {
  if (e.dataTransfer.types.includes("application/x-field-ref")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
}

/** 실행 결과 표시 — Table / JSON / Schema 뷰 모드. */
function NodeOutputView({ state, schema, node_id }: { state?: NodeExecutionState; schema: OutputField[]; node_id: string }) {
  const [viewMode, setViewMode] = useState<"table" | "json" | "schema">("table");

  const output = (state?.result && typeof state.result === "object" && !Array.isArray(state.result))
    ? state.result as Record<string, unknown>
    : null;
  const hasResult = state?.status === "completed" && state.result !== undefined;

  // 상태 배너: 실행 중/실패/건너뜀/대기
  if (state) {
    if (state.status === "pending") return <div className="inspector-empty output-view-pad">대기 중</div>;
    if (state.status === "running") return <div className="inspector-running output-view-pad">⟳ 실행 중...</div>;
    if (state.status === "skipped") return <div className="inspector-empty output-view-pad">⊘ 건너뜀</div>;
    if (state.status === "failed") return (
      <div className="output-view-pad">
        <div className="inspector-error">
          <div className="error-header">✗ 실행 실패</div>
          <pre className="error-detail">{state.error || "알 수 없는 오류"}</pre>
          {state.started_at && <div className="exec-time">시작: {format_time(state.started_at)}</div>}
          {state.completed_at && <div className="exec-time">종료: {format_time(state.completed_at)}</div>}
        </div>
      </div>
    );
  }

  // 실행 결과가 없으면 스키마만 표시
  if (!hasResult) {
    return (
      <div className="output-view-pad">
        {schema.length > 0 ? (
          <div className="output-schema-list">
            {schema.map((field) => (
              <div key={field.name} className="output-schema-row">
                <span className="field-name">{field.name}</span>
                <span className="field-type" style={{ color: FIELD_TYPE_COLORS[field.type] || "#95a5a6" }}>{field.type}</span>
                {field.description && <span className="field-description">{field.description}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="inspector-empty">실행 결과 없음</div>
        )}
      </div>
    );
  }

  return (
    <div className="output-view-pad">
      {/* 실행 시간 */}
      {(state!.started_at || state!.completed_at) && (
        <div className="exec-times">
          {state!.started_at && <span>시작: {format_time(state!.started_at)}</span>}
          {state!.completed_at && <span>종료: {format_time(state!.completed_at)}</span>}
        </div>
      )}

      {/* 뷰 모드 토글 */}
      <div className="output-view-modes" role="tablist">
        <button className={`output-view-mode${viewMode === "table" ? " active" : ""}`} role="tab" aria-selected={viewMode === "table"} onClick={() => setViewMode("table")}>Table</button>
        <button className={`output-view-mode${viewMode === "json" ? " active" : ""}`} role="tab" aria-selected={viewMode === "json"} onClick={() => setViewMode("json")}>JSON</button>
        <button className={`output-view-mode${viewMode === "schema" ? " active" : ""}`} role="tab" aria-selected={viewMode === "schema"} onClick={() => setViewMode("schema")}>Schema</button>
      </div>

      {/* Table 뷰: key-value 테이블 */}
      {viewMode === "table" && output && (
        <table className="output-table">
          <thead>
            <tr><th>Field</th><th>Value</th></tr>
          </thead>
          <tbody>
            {Object.entries(output).map(([key, val]) => (
              <tr key={key}>
                <td className="output-table__key">{key}</td>
                <td className="output-table__val">
                  {typeof val === "object" && val !== null
                    ? <pre className="output-table__pre">{JSON.stringify(val, null, 2)}</pre>
                    : <span>{String(val)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {viewMode === "table" && !output && (
        <pre className="output-json">{format_value(state!.result)}</pre>
      )}

      {/* JSON 뷰: raw JSON */}
      {viewMode === "json" && (
        <pre className="output-json">{format_value(state!.result)}</pre>
      )}

      {/* Schema 뷰: 스키마 필드 + 값 매칭 */}
      {viewMode === "schema" && (
        <div className="output-schema-list">
          {schema.length > 0 ? schema.map((field) => (
            <div key={field.name} className="output-schema-row">
              <div className="output-schema-row__header">
                <span className="field-name">{field.name}</span>
                <span className="field-type" style={{ color: FIELD_TYPE_COLORS[field.type] || "#95a5a6" }}>{field.type}</span>
                {field.description && <span className="field-description">{field.description}</span>}
              </div>
              {output && field.name in output && (
                <pre className="output-schema-row__value">{format_value(output[field.name])}</pre>
              )}
            </div>
          )) : (
            <div className="inspector-empty">출력 스키마가 정의되지 않았습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}

function format_value(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); }
  catch { return String(v); }
}

function format_time(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}
