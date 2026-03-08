/**
 * Inspector parameter panels — Phase, Agent, Critic, Tool, Skill, EndTarget, SubNode.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { NodeOptions } from "./node-registry";
import { BuilderField, BuilderRowPair } from "./builder-field";
import { useProviderModels } from "./use-provider-models";
import { END_TARGET_PARAMS } from "./output-schema";
import type { PhaseDef, AgentDef, CriticDef, ToolNodeDef, SkillNodeDef, WorkflowDef, RolePreset } from "./workflow-types";
import type { TFunction } from "../../../../src/i18n/protocol";
import { handleFieldDrop, handleDragOver } from "./inspector-dnd";

// ── Phase Parameters Panel ──

export function PhaseParamsPanel({ phase, workflow, onChange, onPhaseIdChange, t, options }: {
  phase: PhaseDef;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  onPhaseIdChange?: (newId: string) => void;
  t: TFunction;
  options?: NodeOptions;
}) {
  const pi = workflow.phases.findIndex((p) => p.phase_id === phase.phase_id);
  if (pi < 0) return null;

  const updatePhase = (patch: Partial<PhaseDef>) => {
    const oldId = phase.phase_id;
    const phases = [...workflow.phases];
    phases[pi] = { ...phases[pi]!, ...patch } as PhaseDef;
    let next: WorkflowDef = { ...workflow, phases };
    if (patch.phase_id !== undefined && patch.phase_id !== oldId) {
      const newId = patch.phase_id;
      const rewrite = (ids?: string[]) => ids?.map((id) => (id === oldId ? newId : id));
      next = {
        ...next,
        phases: next.phases.map((p) =>
          p.depends_on?.includes(oldId) ? { ...p, depends_on: rewrite(p.depends_on) } : p,
        ),
        tool_nodes: next.tool_nodes?.map((tn) =>
          tn.attach_to?.includes(oldId) ? { ...tn, attach_to: rewrite(tn.attach_to) } : tn,
        ),
        skill_nodes: next.skill_nodes?.map((sn) =>
          sn.attach_to?.includes(oldId) ? { ...sn, attach_to: rewrite(sn.attach_to) } : sn,
        ),
      };
      onPhaseIdChange?.(newId);
    }
    onChange(next);
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
      <BuilderRowPair>
        <BuilderField label={t("workflows.phase_id")}>
          <input autoFocus className="input input--sm" value={phase.phase_id}
            onChange={(e) => updatePhase({ phase_id: e.target.value })} />
        </BuilderField>
        <BuilderField label={t("workflows.phase_title")}>
          <input className="input input--sm" value={phase.title}
            onChange={(e) => updatePhase({ title: e.target.value })} />
        </BuilderField>
      </BuilderRowPair>

      <BuilderField label={t("workflows.phase_description")}>
        <textarea className="input input--sm" rows={2}
          value={phase.description || ""}
          onChange={(e) => updatePhase({ description: e.target.value })}
          placeholder={t("workflows.phase_description_placeholder")}
        />
      </BuilderField>

      <BuilderField label={t("workflows.phase_mode")}>
        <select className="input input--sm"
          value={phase.mode || "parallel"}
          onChange={(e) => updatePhase({ mode: e.target.value as PhaseDef["mode"] })}
        >
          <option value="parallel">{t("workflows.mode_parallel")}</option>
          <option value="interactive">{t("workflows.mode_interactive")}</option>
          <option value="sequential_loop">{t("workflows.mode_sequential_loop")}</option>
        </select>
      </BuilderField>

      {(phase.mode === "interactive" || phase.mode === "sequential_loop") && (
        <BuilderField label={t("workflows.max_loop_iterations")}>
          <input className="input input--sm" type="number" min={1}
            value={phase.max_loop_iterations ?? (phase.mode === "interactive" ? 20 : 50)}
            onChange={(e) => updatePhase({ max_loop_iterations: Number(e.target.value) || undefined })} />
        </BuilderField>
      )}

      <BuilderField label={t("workflows.context_template")} hint={t("workflows.context_template_hint")}>
        <textarea className="input input--sm inspector-droppable" rows={2}
          value={phase.context_template || ""}
          onChange={(e) => updatePhase({ context_template: e.target.value })}
          onDrop={(e) => handleFieldDrop(e, (ref) => updatePhase({ context_template: (phase.context_template || "") + ref }))}
          onDragOver={handleDragOver}
          placeholder="{{prev_phase.result}}"
          data-droppable="true"
        />
      </BuilderField>

      <div className="inspector-section">
        <div className="inspector-section__header">
          <span className="inspector-section__title">
            {t("workflows.agents_count", { n: String(phase.agents.length) })}
          </span>
          <button className="btn btn--xs btn--accent" onClick={addAgent}>{t("workflows.add_agent_btn")}</button>
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

      <div className="inspector-section">
        <div className="inspector-section__header">
          <span className="inspector-section__title">{t("workflows.critic")}</span>
          <button className="btn btn--xs" onClick={toggleCritic}>
            {phase.critic ? t("workflows.remove") : t("workflows.add")}
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

export function AgentSummaryCard({ agent, index, phase, workflow, onChange, onNodeIdChange, t, options }: {
  agent: AgentDef;
  index: number;
  phase: PhaseDef;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  onNodeIdChange?: (newId: string) => void;
  t: TFunction;
  options?: NodeOptions;
}) {
  const [expanded, setExpanded] = useState(false);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phase.phase_id);
  const { models: providerModels, loading: modelsLoading } = useProviderModels(agent.backend, options);

  const { data: roles } = useQuery<RolePreset[]>({
    queryKey: ["workflow-roles"],
    queryFn: () => api.get("/api/workflow/roles"),
    staleTime: 60_000,
  });

  const updateAgent = (patch: Partial<AgentDef>) => {
    const oldAgentId = agent.agent_id;
    const phases = [...workflow.phases];
    const agents = [...phase.agents];
    agents[index] = { ...agents[index]!, ...patch };
    phases[pi] = { ...phase, agents };
    onChange({ ...workflow, phases });
    if (patch.agent_id !== undefined && patch.agent_id !== oldAgentId) {
      onNodeIdChange?.(`${phase.phase_id}__${patch.agent_id}`);
    }
  };

  const applyRole = (roleId: string) => {
    const preset = roles?.find((r) => r.id === roleId);
    if (!preset) {
      updateAgent({ role: roleId });
      return;
    }
    const prompt_parts: string[] = [];
    if (preset.soul) prompt_parts.push(preset.soul);
    if (preset.heart) prompt_parts.push(preset.heart);
    updateAgent({
      role: preset.id,
      label: preset.name,
      system_prompt: prompt_parts.join("\n\n") || "",
      tools: preset.tools.length > 0 ? preset.tools : undefined,
    });
  };

  const removeAgent = () => {
    if (phase.agents.length <= 1) return;
    const phases = [...workflow.phases];
    const agents = phase.agents.filter((_, i) => i !== index);
    phases[pi] = { ...phase, agents };
    onChange({ ...workflow, phases });
  };

  const isPresetRole = roles?.some((r) => r.id === agent.role);

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">🤖</span>
        <span className="inspector-card__label">{agent.label || agent.agent_id}</span>
        <span className="inspector-card__meta">{agent.backend || t("workflows.no_backend")}</span>
        <svg className={`inspector-card__toggle${expanded ? "" : " inspector-card__toggle--closed"}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <BuilderRowPair>
            <BuilderField label={t("workflows.agent_id")}>
              <input className="input input--sm" value={agent.agent_id}
                onChange={(e) => updateAgent({ agent_id: e.target.value })} />
            </BuilderField>
            <BuilderField label={t("workflows.agent_label")}>
              <input className="input input--sm" value={agent.label}
                onChange={(e) => updateAgent({ label: e.target.value })} />
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.select_role")}>
            <select className="input input--sm"
              value={isPresetRole ? agent.role : ""}
              onChange={(e) => { if (e.target.value) applyRole(e.target.value); }}>
              <option value="">{t("workflows.custom_role")}</option>
              {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </BuilderField>
          {!isPresetRole && (
            <BuilderField label={t("workflows.agent_role")}>
              <input className="input input--sm" value={agent.role}
                onChange={(e) => updateAgent({ role: e.target.value })} />
            </BuilderField>
          )}
          {isPresetRole && (
            <div className="builder-meta-hint--mb">
              {t("workflows.role_auto_prompt")}
            </div>
          )}
          <BuilderRowPair>
            <BuilderField label={t("workflows.backend")}>
              <select className="input input--sm" value={agent.backend}
                onChange={(e) => updateAgent({ backend: e.target.value })}>
                <option value="">-</option>
                {(options?.backends || []).map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.available === false ? "\u26AA " : "\uD83D\uDFE2 "}{b.label}{b.provider_type ? ` (${b.provider_type})` : ""}
                  </option>
                ))}
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.model")}>
              {modelsLoading ? (
                <input className="input input--sm" disabled placeholder="loading..." />
              ) : providerModels.length > 0 ? (
                <select className="input input--sm" value={agent.model || ""}
                  onChange={(e) => updateAgent({ model: e.target.value || undefined })}>
                  <option value="">auto</option>
                  {providerModels.filter((m) => m.purpose !== "embedding").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ) : (
                <input className="input input--sm" value={agent.model || ""}
                  onChange={(e) => updateAgent({ model: e.target.value || undefined })}
                  placeholder="auto" />
              )}
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.max_turns")}>
            <input className="input input--sm" type="number" min={0}
              value={agent.max_turns ?? 3}
              onChange={(e) => updateAgent({ max_turns: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.system_prompt")}>
            <textarea className="input input--sm inspector-droppable" rows={4}
              value={agent.system_prompt}
              onChange={(e) => updateAgent({ system_prompt: e.target.value })}
              onDrop={(e) => handleFieldDrop(e, (ref) => updateAgent({ system_prompt: agent.system_prompt + ref }))}
              onDragOver={handleDragOver}
              data-droppable="true"
            />
          </BuilderField>
          <div className="inspector-card__actions">
            <button className="btn btn--xs btn--danger" onClick={removeAgent}
              disabled={phase.agents.length <= 1}>
              {t("workflows.delete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Critic Summary Card ──

export function CriticSummaryCard({ critic, phase, workflow, onChange, t, options }: {
  critic: CriticDef;
  phase: PhaseDef;
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  t: TFunction;
  options?: NodeOptions;
}) {
  const [expanded, setExpanded] = useState(false);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phase.phase_id);
  const { models: criticModels, loading: criticModelsLoading } = useProviderModels(critic.backend, options);

  const updateCritic = (patch: Partial<CriticDef>) => {
    const phases = [...workflow.phases];
    phases[pi] = { ...phase, critic: { ...critic, ...patch } };
    onChange({ ...workflow, phases });
  };

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">⚖</span>
        <span className="inspector-card__label">{t("workflows.critic")}</span>
        <span className="inspector-card__meta">gate={critic.gate ? t("workflows.gate_yes") : t("workflows.gate_no")}</span>
        <svg className={`inspector-card__toggle${expanded ? "" : " inspector-card__toggle--closed"}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <BuilderRowPair>
            <BuilderField label={t("workflows.backend")}>
              <select className="input input--sm" value={critic.backend}
                onChange={(e) => updateCritic({ backend: e.target.value })}>
                <option value="">-</option>
                {(options?.backends || []).map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.available === false ? "\u26AA " : "\uD83D\uDFE2 "}{b.label}{b.provider_type ? ` (${b.provider_type})` : ""}
                  </option>
                ))}
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.model")}>
              {criticModelsLoading ? (
                <input className="input input--sm" disabled placeholder="loading..." />
              ) : criticModels.length > 0 ? (
                <select className="input input--sm" value={critic.model || ""}
                  onChange={(e) => updateCritic({ model: e.target.value || undefined })}>
                  <option value="">auto</option>
                  {criticModels.filter((m) => m.purpose !== "embedding").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ) : (
                <input className="input input--sm" value={critic.model || ""}
                  onChange={(e) => updateCritic({ model: e.target.value || undefined })}
                  placeholder="auto" />
              )}
            </BuilderField>
          </BuilderRowPair>
          <BuilderRowPair>
            <BuilderField label={t("workflows.gate_label")}>
              <select className="input input--sm" value={critic.gate ? "true" : "false"}
                onChange={(e) => updateCritic({ gate: e.target.value === "true" })}>
                <option value="true">{t("workflows.gate_yes")}</option>
                <option value="false">{t("workflows.gate_no")}</option>
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.on_rejection")}>
              <select className="input input--sm" value={critic.on_rejection || ""}
                onChange={(e) => updateCritic({ on_rejection: e.target.value || undefined })}>
                <option value="">-</option>
                <option value="retry_all">retry_all</option>
                <option value="retry_targeted">retry_targeted</option>
                <option value="escalate">escalate</option>
              </select>
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.system_prompt")}>
            <textarea className="input input--sm inspector-droppable" rows={4}
              value={critic.system_prompt}
              onChange={(e) => updateCritic({ system_prompt: e.target.value })}
              onDrop={(e) => handleFieldDrop(e, (ref) => updateCritic({ system_prompt: critic.system_prompt + ref }))}
              onDragOver={handleDragOver}
              data-droppable="true"
            />
          </BuilderField>
        </div>
      )}
    </div>
  );
}

// ── Sub-node dispatcher ──

export function SubNodeParamsPanel({ subNodeId, subType, workflow, onChange, onNodeIdChange, t, options }: {
  subNodeId: string;
  subType: "agent" | "critic" | "tool_sub" | "skill_sub";
  workflow: WorkflowDef;
  onChange: (w: WorkflowDef) => void;
  onNodeIdChange?: (newId: string) => void;
  t: TFunction;
  options?: NodeOptions;
}) {
  if (subType === "tool_sub") {
    const match = subNodeId.match(/^(.+)__tool_(.+)$/);
    if (!match) return <div className="inspector-empty">{t("workflows.invalid_sub_node_id")}</div>;
    const toolNodeId = match[2]!;
    const nodes = workflow.tool_nodes || [];
    const idx = nodes.findIndex((n) => n.id === toolNodeId);
    if (idx < 0) return <div className="inspector-empty">{t("workflows.node_not_found")}</div>;
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

  if (subType === "skill_sub") {
    const match = subNodeId.match(/^(.+)__skill_(.+)$/);
    if (!match) return <div className="inspector-empty">{t("workflows.invalid_sub_node_id")}</div>;
    const skillNodeId = match[2]!;
    const nodes = workflow.skill_nodes || [];
    const idx = nodes.findIndex((n) => n.id === skillNodeId);
    if (idx < 0) return <div className="inspector-empty">{t("workflows.node_not_found")}</div>;
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

  const sep = subNodeId.indexOf("__");
  if (sep < 0) return <div className="inspector-empty">{t("workflows.invalid_sub_node_id")}</div>;
  const phaseId = subNodeId.slice(0, sep);
  const subId = subNodeId.slice(sep + 2);
  const pi = workflow.phases.findIndex((p) => p.phase_id === phaseId);
  if (pi < 0) return <div className="inspector-empty">{t("workflows.phase_not_found")}</div>;
  const phase = workflow.phases[pi]!;

  if (subType === "critic" || subId === "critic") {
    if (!phase.critic) return <div className="inspector-empty">{t("workflows.no_critic")}</div>;
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
  if (agentIdx < 0) return <div className="inspector-empty">{t("workflows.agent_not_found")}</div>;

  return (
    <AgentSummaryCard
      agent={phase.agents[agentIdx]!}
      index={agentIdx}
      phase={phase}
      workflow={workflow}
      onChange={onChange}
      onNodeIdChange={onNodeIdChange}
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
  t: TFunction;
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

  const toolDef = toolDefinitions.find((d) =>
    (d as { function?: { name?: string } }).function?.name === node.tool_id
  ) as { function?: { name?: string; parameters?: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }> } } } | undefined;
  const paramSchema = toolDef?.function?.parameters?.properties || {};
  const params = node.params || {};

  return (
    <div className="inspector-card">
      <div className="inspector-card__header" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="inspector-card__icon">🔧</span>
        <span className="inspector-card__label">{node.tool_id || t("workflows.tool_id")}</span>
        <span className="inspector-card__meta">{node.id}</span>
        <svg className={`inspector-card__toggle${expanded ? "" : " inspector-card__toggle--closed"}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <BuilderField label={t("workflows.tool_id")}>
            {availableTools.length > 0 ? (
              <select className="input input--sm" value={node.tool_id} onChange={(e) => update({ tool_id: e.target.value })}>
                <option value="">—</option>
                {availableTools.map((tid) => <option key={tid} value={tid}>{tid}</option>)}
              </select>
            ) : (
              <input className="input input--sm" value={node.tool_id}
                onChange={(e) => update({ tool_id: e.target.value })} placeholder="tool_name" />
            )}
          </BuilderField>
          <BuilderField label={t("workflows.description")}>
            <input className="input input--sm" value={node.description}
              onChange={(e) => update({ description: e.target.value })} />
          </BuilderField>
          <BuilderField label={t("workflows.attach_to_phases")}>
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
          </BuilderField>
          {Object.keys(paramSchema).length > 0 && (
            <BuilderField label={t("workflows.tool_params")}>
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
            </BuilderField>
          )}
          <div className="inspector-card__actions">
            <button className="btn btn--xs btn--danger" onClick={remove}>
              {t("workflows.delete")}
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
  t: TFunction;
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
        <span className="inspector-card__label">{node.skill_name || t("workflows.skill_name")}</span>
        <span className="inspector-card__meta">{node.id}</span>
        <svg className={`inspector-card__toggle${expanded ? "" : " inspector-card__toggle--closed"}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {expanded && (
        <div className="inspector-card__body">
          <BuilderField label={t("workflows.skill_name")}>
            {availableSkills.length > 0 ? (
              <select className="input input--sm" value={node.skill_name} onChange={(e) => update({ skill_name: e.target.value })}>
                <option value="">—</option>
                {availableSkills.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input className="input input--sm" value={node.skill_name}
                onChange={(e) => update({ skill_name: e.target.value })} placeholder="skill_name" />
            )}
          </BuilderField>
          <BuilderField label={t("workflows.description")}>
            <input className="input input--sm" value={node.description}
              onChange={(e) => update({ description: e.target.value })} />
          </BuilderField>
          <BuilderField label={t("workflows.attach_to_phases")}>
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
          </BuilderField>
          <div className="inspector-card__actions">
            <button className="btn btn--xs btn--danger" onClick={remove}>
              {t("workflows.delete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── End Target Parameters Panel ──

export function EndTargetParamsPanel({ target, node, onUpdate, t }: {
  target: string;
  node: Record<string, unknown>;
  onUpdate: (partial: Record<string, unknown>) => void;
  t: TFunction;
}) {
  const params = END_TARGET_PARAMS[target];
  if (!params || params.length === 0) {
    return <div className="inspector-empty">{t("workflows.no_params")}</div>;
  }
  return (
    <div className="inspector-params-grid">
      {params.map((param) => {
        const fieldKey = param.name.split(".")[1]!;
        return (
          <BuilderField key={param.name} label={t(param.description || fieldKey) || fieldKey}>
            <input
              className="input input--sm inspector-droppable"
              value={String(node[fieldKey] ?? "")}
              onChange={(e) => onUpdate({ [fieldKey]: e.target.value })}
              placeholder={`{{prev.result}} or value`}
              data-droppable="true"
            />
          </BuilderField>
        );
      })}
    </div>
  );
}
