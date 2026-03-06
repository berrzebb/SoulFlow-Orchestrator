import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import { api } from "../../api/client";

import { useToast } from "../../components/toast";
import { useModalEffects } from "../../components/modal";
import { useT } from "../../i18n";
import { GraphEditor, type WorkflowDef, type AgentDef, type CriticDef, type PhaseDef, type ToolNodeDef, type SkillNodeDef, type OrcheNodeDef, type TriggerNodeDef } from "./graph-editor";
import { get_frontend_node } from "./node-registry";
import { NodeInspector, type UpstreamRef } from "./node-inspector";
import { get_output_fields } from "./output-schema";

/** /api/tools 응답. */
type ToolsApiResponse = { names: string[]; definitions: Array<Record<string, unknown>>; mcp_servers: Array<{ name: string; tools: string[] }> };
/** /api/skills 응답 (간략). */
type SkillListItem = { name: string; summary?: string; source?: string };
/** /api/channels/instances 응답 항목. */
type ChannelInstanceInfo = { instance_id: string; provider: string; label: string; enabled: boolean; running: boolean };
/** /api/agents/providers 응답 항목 (간략). */
type ProviderInfo = { instance_id: string; label: string; enabled: boolean; available: boolean };

interface RolePreset {
  id: string;
  name: string;
  description: string;
  soul: string | null;
  heart: string | null;
  tools: string[];
}

// Types: AgentDef, CriticDef, PhaseDef, WorkflowDef → graph-editor.tsx에서 import

const REJECTION_POLICIES = ["retry_all", "retry_targeted", "escalate"];

function empty_agent(index: number, defaultBackend = ""): AgentDef {
  return { agent_id: `agent-${index + 1}`, role: "", label: "", backend: defaultBackend, system_prompt: "", max_turns: 3 };
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
  const [workflow, setWorkflowRaw] = useState<WorkflowDef>(empty_workflow);
  // Undo/Redo 히스토리
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const MAX_HISTORY = 50;
  const setWorkflow = (next: WorkflowDef) => {
    setWorkflowRaw((prev) => {
      const h = historyRef.current;
      h.past.push(JSON.stringify(prev));
      if (h.past.length > MAX_HISTORY) h.past.shift();
      h.future = [];
      return next;
    });
  };
  const undo = () => {
    const h = historyRef.current;
    if (!h.past.length) return;
    setWorkflowRaw((prev) => {
      h.future.push(JSON.stringify(prev));
      const restored = JSON.parse(h.past.pop()!) as WorkflowDef;
      return restored;
    });
  };
  const redo = () => {
    const h = historyRef.current;
    if (!h.future.length) return;
    setWorkflowRaw((prev) => {
      h.past.push(JSON.stringify(prev));
      const restored = JSON.parse(h.future.pop()!) as WorkflowDef;
      return restored;
    });
  };
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [templateName, setTemplateName] = useState(name || "");
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [editPhaseId, setEditPhaseId] = useState<string | null>(null);
  const [cronModalOpen, setCronModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [yamlSideOpen, setYamlSideOpen] = useState(false);
  const [yamlSideDirty, setYamlSideDirty] = useState(false);
  const [editOrcheNodeId, setEditOrcheNodeId] = useState<string | null>(null);
  const [editSubNodeId, setEditSubNodeId] = useState<string | null>(null);
  const [editTriggerNodeId, setEditTriggerNodeId] = useState<string | null>(null);
  const [nodeRunResult, setNodeRunResult] = useState<{ id: string; mode: string; result?: Record<string, unknown>; error?: string; loading: boolean } | null>(null);
  /** 우측 인스펙터 패널 대상 노드. */
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);

  // Ctrl+Z / Ctrl+Y 바인딩
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key === "z" && e.shiftKey) { e.preventDefault(); redo(); }
      else if (e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // 등록된 도구/스킬/채널 목록 fetch
  const { data: toolsData } = useQuery<ToolsApiResponse>({
    queryKey: ["registered-tools"],
    queryFn: () => api.get("/api/tools"),
    staleTime: 60_000,
  });
  const { data: skillsData } = useQuery<SkillListItem[]>({
    queryKey: ["registered-skills"],
    queryFn: () => api.get("/api/skills"),
    staleTime: 60_000,
  });
  const { data: channelsData } = useQuery<ChannelInstanceInfo[]>({
    queryKey: ["registered-channels"],
    queryFn: () => api.get("/api/channels/instances"),
    staleTime: 60_000,
  });

  // 노드 편집 패널용 추가 리소스 fetch
  const { data: providersData } = useQuery<ProviderInfo[]>({
    queryKey: ["agent-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    staleTime: 60_000,
  });
  const { data: modelsData } = useQuery<{ name: string }[]>({
    queryKey: ["models"],
    queryFn: () => api.get("/api/models"),
    staleTime: 60_000,
  });
  const { data: oauthData } = useQuery<{ instance_id: string; label: string; service_type: string; enabled: boolean }[]>({
    queryKey: ["oauth-integrations"],
    queryFn: () => api.get("/api/oauth/integrations"),
    staleTime: 60_000,
  });
  const { data: wfTemplatesData } = useQuery<{ title: string; slug: string }[]>({
    queryKey: ["workflow-templates-list"],
    queryFn: () => api.get("/api/workflow/templates"),
    staleTime: 60_000,
  });

  const availableTools: string[] = toolsData?.names || [];
  const availableSkills: string[] = (skillsData || []).map((s) => s.name);
  const availableChannels = (channelsData || []).filter((c) => c.enabled);

  /** 노드 편집 패널에 전달할 동적 옵션. */
  const nodeOptions = {
    backends: (providersData || []).filter((p) => p.enabled).map((p) => ({ value: p.instance_id, label: p.label || p.instance_id })),
    models: modelsData || [],
    oauth_integrations: (oauthData || []).filter((o) => o.enabled),
    workflow_templates: wfTemplatesData || [],
    channels: (channelsData || []).filter((c) => c.enabled).map((c) => ({
      provider: c.provider, channel_id: c.instance_id, label: c.label, enabled: c.enabled,
    })),
    available_tools: availableTools,
    tool_definitions: (toolsData?.definitions || []) as Array<Record<string, unknown>>,
    available_skills: availableSkills,
  };

  // 기존 템플릿 로드
  const { data: existing } = useQuery<WorkflowDef>({
    queryKey: ["workflow-template", name],
    queryFn: () => api.get(`/api/workflow/templates/${encodeURIComponent(name!)}`),
    enabled: !isNew,
  });

  useEffect(() => {
    if (existing) {
      setWorkflowRaw(existing);
      historyRef.current = { past: [], future: [] };
      setTemplateName(name || existing.title);
      try { setYamlText(yaml.dump(existing, { lineWidth: -1, noRefs: true })); } catch { /* ignore */ }
    }
  }, [existing, name]);

  // YAML ↔ 폼 동기화
  const sync_yaml_from_form = () => {
    try {
      setYamlText(yaml.dump(workflow, { lineWidth: -1, noRefs: true }));
      setYamlError("");
    } catch { /* ignore */ }
  };

  const sync_form_from_yaml = () => {
    try {
      const parsed = yaml.load(yamlText) as WorkflowDef;
      if (!parsed || typeof parsed !== "object" || typeof parsed.title !== "string" || !Array.isArray(parsed.phases) || parsed.phases.length === 0) {
        setYamlError("Invalid: title (string) and phases (non-empty array) required");
        return false;
      }
      // Phase의 tools[]/skills[]에서 tool_nodes/skill_nodes 자동 생성
      const existing_tools = new Set((parsed.tool_nodes || []).map((n) => n.tool_id));
      const existing_skills = new Set((parsed.skill_nodes || []).map((n) => n.skill_name));
      const auto_tools: ToolNodeDef[] = [...(parsed.tool_nodes || [])];
      const auto_skills: SkillNodeDef[] = [...(parsed.skill_nodes || [])];
      for (const phase of parsed.phases) {
        for (const tid of phase.tools || []) {
          if (!existing_tools.has(tid)) {
            existing_tools.add(tid);
            auto_tools.push({ id: `tool-${auto_tools.length + 1}`, tool_id: tid, description: tid, attach_to: [phase.phase_id] });
          }
        }
        for (const sid of phase.skills || []) {
          if (!existing_skills.has(sid)) {
            existing_skills.add(sid);
            auto_skills.push({ id: `skill-${auto_skills.length + 1}`, skill_name: sid, description: sid, attach_to: [phase.phase_id] });
          }
        }
      }
      if (auto_tools.length) parsed.tool_nodes = auto_tools;
      if (auto_skills.length) parsed.skill_nodes = auto_skills;
      setWorkflow(parsed);
      setYamlError("");
      return true;
    } catch (e) {
      setYamlError(String(e));
      return false;
    }
  };

  const handleTabSwitch = (newTab: "graph" | "builder" | "yaml") => {
    if (newTab === "yaml" && tab !== "yaml") sync_yaml_from_form();
    if (newTab !== "yaml" && tab === "yaml") {
      if (!sync_form_from_yaml()) {
        toast(t("workflows.yaml_parse_error") || "YAML parsing failed. Fix errors before switching tabs.", "err");
        return;
      }
    }
    setTab(newTab);
  };

  // 저장
  const saveMut = useMutation({
    mutationFn: (data: { name: string; def: WorkflowDef }) =>
      api.put<{ ok: boolean; name: string }>(`/api/workflow/templates/${encodeURIComponent(data.name)}`, data.def),
    onSuccess: (result) => {
      toast(t("workflows.template_saved"), "ok");
      qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      if (isNew && result.name) navigate(`/workflows/edit/${encodeURIComponent(result.name)}`, { replace: true });
    },
    onError: () => toast(t("workflows.save_failed"), "err"),
  });

  const handleSave = () => {
    if (tab === "yaml" && !sync_form_from_yaml()) return;
    const slug = templateName || workflow.title || "untitled";
    saveMut.mutate({ name: slug, def: workflow });
  };


  // 실행
  const runMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean; workflow_id?: string }>("/api/workflow/runs", body),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) navigate(`/workflows/${data.workflow_id}`);
    },
    onError: () => toast(t("workflows.run_failed"), "err"),
  });

  const handleRun = () => {
    if (tab === "yaml" && !sync_form_from_yaml()) return;
    runMut.mutate({
      title: workflow.title, objective: workflow.objective, phases: workflow.phases,
      tool_nodes: workflow.tool_nodes, skill_nodes: workflow.skill_nodes,
      trigger: workflow.trigger, hitl_channel: workflow.hitl_channel,
    });
  };

  /** Run 전 입력 프롬프트 상태: Phase 노드 Run 시 objective 입력용. */
  const [runInputPrompt, setRunInputPrompt] = useState<{ id: string; node: Record<string, unknown> } | null>(null);

  /** 노드 실행 API 호출. */
  const executeNode = async (id: string, mode: "run" | "test", node: Record<string, unknown>, input_memory: Record<string, unknown>) => {
    setNodeRunResult({ id, mode, loading: true });
    try {
      const endpoint = mode === "test" ? "/api/workflow/node/tests" : "/api/workflow/node/runs";
      const result = await api.post<Record<string, unknown>>(endpoint, { node, input_memory });
      setNodeRunResult({ id, mode, result, loading: false });
      toast(mode === "test" ? t("workflows.test_node_done") : t("workflows.run_node_done"), "ok");
    } catch (e) {
      setNodeRunResult({ id, mode, error: String(e), loading: false });
      toast(t("workflows.node_run_error"), "err");
    }
  };

  /** 노드 단독 실행 (▶ 버튼). Phase Run → 입력 프롬프트, 나머지 → 즉시 실행. */
  const handleRunNode = (id: string, mode: "run" | "test") => {
    const phase = workflow.phases.find((p) => p.phase_id === id);
    const orche = (workflow.orche_nodes || []).find((n) => n.node_id === id);
    const node: Record<string, unknown> | undefined = phase
      ? { node_type: "phase", node_id: id, title: phase.title, agents: phase.agents, critic: phase.critic, context_template: phase.context_template }
      : orche as Record<string, unknown> | undefined;
    if (!node) return;

    // Phase + Run 모드 → objective 입력 프롬프트
    if (phase && mode === "run") {
      setRunInputPrompt({ id, node });
      return;
    }
    // Test 모드 또는 오케 노드 → 즉시 실행
    void executeNode(id, mode, node, {});
  };

  /** inspectorNodeId에서 노드 데이터·타입·라벨·update 콜백을 resolve. */
  const resolveInspectorNode = (id: string): {
    node: Record<string, unknown>; node_type: string; node_label: string;
    onUpdate: (partial: Record<string, unknown>) => void;
  } | null => {
    // Sub-node: "{phaseId}__{agentId}" 또는 "{phaseId}__critic"
    const sep = id.indexOf("__");
    if (sep >= 0) {
      const phaseId = id.slice(0, sep);
      const subId = id.slice(sep + 2);
      const phase = workflow.phases.find((p) => p.phase_id === phaseId);
      if (!phase) return null;
      // Tool sub-node
      if (subId.startsWith("tool_")) {
        const toolNodeId = subId.slice(5); // "tool_xxx" → "xxx"
        const toolNode = (workflow.tool_nodes || []).find((n) => n.id === toolNodeId);
        if (!toolNode) return null;
        return {
          node: toolNode as unknown as Record<string, unknown>,
          node_type: "tool_sub",
          node_label: toolNode.tool_id || toolNode.id,
          onUpdate: () => {},
        };
      }
      // Skill sub-node
      if (subId.startsWith("skill_")) {
        const skillNodeId = subId.slice(6); // "skill_xxx" → "xxx"
        const skillNode = (workflow.skill_nodes || []).find((n) => n.id === skillNodeId);
        if (!skillNode) return null;
        return {
          node: skillNode as unknown as Record<string, unknown>,
          node_type: "skill_sub",
          node_label: skillNode.skill_name || skillNode.id,
          onUpdate: () => {},
        };
      }
      if (subId === "critic" && phase.critic) {
        return {
          node: phase.critic as unknown as Record<string, unknown>,
          node_type: "critic",
          node_label: `Critic — ${phase.title}`,
          onUpdate: () => {},
        };
      }
      const agent = phase.agents.find((a) => a.agent_id === subId);
      if (agent) {
        return {
          node: agent as unknown as Record<string, unknown>,
          node_type: "agent",
          node_label: agent.label || agent.agent_id,
          onUpdate: () => {},
        };
      }
    }
    // Trigger node
    const tn = (workflow.trigger_nodes || []).find((n) => n.id === id);
    if (tn) {
      return {
        node: tn as unknown as Record<string, unknown>,
        node_type: `trigger_${tn.trigger_type}`,
        node_label: `Trigger: ${tn.trigger_type}`,
        onUpdate: (partial) => {
          const nodes = (workflow.trigger_nodes || []).map((n) => n.id === id ? { ...n, ...partial } as TriggerNodeDef : n);
          setWorkflow({ ...workflow, trigger_nodes: nodes });
        },
      };
    }
    // Orche node
    const on = (workflow.orche_nodes || []).find((n) => n.node_id === id);
    if (on) {
      return {
        node: on as unknown as Record<string, unknown>,
        node_type: on.node_type,
        node_label: on.title || on.node_type,
        onUpdate: (partial) => {
          const nodes = (workflow.orche_nodes || []).map((n) => n.node_id === id ? { ...n, ...partial } as OrcheNodeDef : n);
          setWorkflow({ ...workflow, orche_nodes: nodes });
        },
      };
    }
    // Phase node
    const pi = workflow.phases.findIndex((p) => p.phase_id === id);
    if (pi >= 0) {
      const phase = workflow.phases[pi]!;
      return {
        node: phase as unknown as Record<string, unknown>,
        node_type: "phase",
        node_label: phase.title || phase.phase_id,
        onUpdate: (partial) => {
          const phases = [...workflow.phases];
          phases[pi] = { ...phases[pi]!, ...partial } as PhaseDef;
          setWorkflow({ ...workflow, phases });
        },
      };
    }
    return null;
  };

  const inspectorData = inspectorNodeId ? resolveInspectorNode(inspectorNodeId) : null;

  /** 선택된 노드의 상류 노드들 출력 필드 (드래그 참조용). */
  const upstreamRefs: UpstreamRef[] = (() => {
    if (!inspectorNodeId) return [];
    const refs: UpstreamRef[] = [];
    // Phase의 depends_on (명시적) 또는 배열 순서 기반 암시적 의존성
    const phase = workflow.phases.find((p) => p.phase_id === inspectorNodeId);
    const orcheNode = (workflow.orche_nodes || []).find((n) => n.node_id === inspectorNodeId);
    let deps: string[] = phase?.depends_on || (orcheNode?.depends_on as string[] | undefined) || [];
    // Phase에 depends_on이 없으면 배열에서 이전 Phase를 암시적 의존성으로 추가
    if (phase && !deps.length) {
      const pi = workflow.phases.indexOf(phase);
      if (pi > 0) deps = [workflow.phases[pi - 1]!.phase_id];
    }
    for (const depId of deps) {
      const depPhase = workflow.phases.find((p) => p.phase_id === depId);
      if (depPhase) {
        refs.push({ node_id: depId, node_label: depPhase.title || depId, fields: get_output_fields(depPhase) });
        continue;
      }
      const depOrche = (workflow.orche_nodes || []).find((n) => n.node_id === depId);
      if (depOrche) {
        refs.push({ node_id: depId, node_label: depOrche.title || depId, fields: get_output_fields(depOrche) });
      }
    }
    // field_mappings에서 이 노드를 to_node로 참조하는 소스들
    for (const m of workflow.field_mappings || []) {
      if (m.to_node !== inspectorNodeId) continue;
      if (refs.some((r) => r.node_id === m.from_node)) continue;
      const srcPhase = workflow.phases.find((p) => p.phase_id === m.from_node);
      if (srcPhase) {
        refs.push({ node_id: m.from_node, node_label: srcPhase.title || m.from_node, fields: get_output_fields(srcPhase) });
        continue;
      }
      const srcOrche = (workflow.orche_nodes || []).find((n) => n.node_id === m.from_node);
      if (srcOrche) {
        refs.push({ node_id: m.from_node, node_label: srcOrche.title || m.from_node, fields: get_output_fields(srcOrche) });
      }
    }
    return refs;
  })();

  return (
    <div className="page page--full-height">
      {/* 헤더 */}
      <div className="section-header">
        <div className="builder-header__left">
          <button className="btn btn--sm" onClick={() => navigate("/workflows")}>
            ← {t("workflows.back")}
          </button>
          <input
            className="input builder-name-input"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("workflows.template_name")}
          />
        </div>
        <div className="builder-header__right">
          <button className="btn btn--sm btn--accent" onClick={handleSave} disabled={saveMut.isPending}>
            {t("workflows.save_template")}
          </button>
          <button className="btn btn--sm" onClick={handleRun} disabled={runMut.isPending}>
            {t("workflows.run_template")}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="builder-tabs" role="tablist">
        <button className={`builder-tab${tab === "graph" ? " active" : ""}`} role="tab" aria-selected={tab === "graph"} onClick={() => handleTabSwitch("graph")}>
          {t("workflows.graph_tab")}
        </button>
        <button className={`builder-tab${tab === "builder" ? " active" : ""}`} role="tab" aria-selected={tab === "builder"} onClick={() => handleTabSwitch("builder")}>
          {t("workflows.builder_tab")}
        </button>
        <button className={`builder-tab${tab === "yaml" ? " active" : ""}`} role="tab" aria-selected={tab === "yaml"} onClick={() => handleTabSwitch("yaml")}>
          {t("workflows.yaml_tab")}
        </button>
        {tab === "graph" && (
          <button
            className={`builder-tab builder-tab--yaml-toggle${yamlSideOpen ? " active" : ""}`}
            onClick={() => { if (!yamlSideOpen) { sync_yaml_from_form(); setYamlSideDirty(false); } setYamlSideOpen(!yamlSideOpen); }}
            aria-expanded={yamlSideOpen}
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
              onChange={(e) => { setYamlText(e.target.value); setYamlSideDirty(true); }}
              onBlur={() => { if (yamlSideDirty) { sync_form_from_yaml(); setYamlSideDirty(false); } }}
              spellCheck={false}
            />
            {yamlError && <div className="yaml-error">{yamlError}</div>}
          </div>
          {/* 메인 그래프 영역 */}
          <div className="graph-layout__main">
            {/* 보조 노드 추가는 GraphEditor 내 NodePicker로 통합 */}
            <GraphEditor
              workflow={workflow}
              onChange={setWorkflow}
              selectedPhaseId={selectedPhaseId}
              onSelectPhase={(id) => { setSelectedPhaseId(id); if (id) setInspectorNodeId(id); }}
              onEditPhase={(id) => setInspectorNodeId(id)}
              onRunNode={handleRunNode}
              onEditSubNode={(id) => {
                setInspectorNodeId(id);
              }}
              runningNodeId={nodeRunResult?.loading ? nodeRunResult.id : null}
              orcheStates={nodeRunResult ? [{
                node_id: nodeRunResult.id,
                status: nodeRunResult.loading ? "running" : nodeRunResult.error ? "failed" : "completed",
              }] : undefined}
            />
            {runInputPrompt && (
              <NodeRunInputBar
                nodeId={runInputPrompt.id}
                onSubmit={(objective) => {
                  const { id, node } = runInputPrompt;
                  setRunInputPrompt(null);
                  void executeNode(id, "run", node, { objective });
                }}
                onCancel={() => setRunInputPrompt(null)}
              />
            )}
          </div>
          {/* 우측 아웃풋 사이드 패널 */}
          {nodeRunResult && !inspectorNodeId && (
            <NodeRunOutputPanel result={nodeRunResult} onClose={() => setNodeRunResult(null)} />
          )}
          {/* 우측 노드 인스펙터 패널 */}
          {inspectorNodeId && inspectorData && (
            <NodeInspector
              node={inspectorData.node}
              node_id={inspectorNodeId}
              node_type={inspectorData.node_type}
              node_label={inspectorData.node_label}
              execution_state={nodeRunResult && nodeRunResult.id === inspectorNodeId ? {
                node_id: nodeRunResult.id,
                node_type: inspectorData.node_type,
                status: nodeRunResult.loading ? "running" : nodeRunResult.error ? "failed" : "completed",
                result: nodeRunResult.result,
                error: nodeRunResult.error,
              } : undefined}
              onUpdate={inspectorData.onUpdate}
              onClose={() => setInspectorNodeId(null)}
              t={t}
              options={nodeOptions}
              workflow={workflow}
              onWorkflowChange={setWorkflow}
              upstream_refs={upstreamRefs}
            />
          )}
          {editPhaseId && (
            <PhaseEditModal
              workflow={workflow}
              phaseId={editPhaseId}
              onChange={setWorkflow}
              onClose={() => setEditPhaseId(null)}
            />
          )}
          {cronModalOpen && (
            <CronEditModal
              trigger={workflow.trigger}
              onChange={(trigger) => setWorkflow({ ...workflow, trigger })}
              onRemove={() => { const { trigger: _, ...rest } = workflow; setWorkflow(rest as WorkflowDef); }}
              onClose={() => setCronModalOpen(false)}
            />
          )}
          {channelModalOpen && (
            <ChannelEditModal
              channel={workflow.hitl_channel}
              onChange={(hitl_channel) => setWorkflow({ ...workflow, hitl_channel })}
              onRemove={() => { const { hitl_channel: _, ...rest } = workflow; setWorkflow(rest as WorkflowDef); }}
              onClose={() => setChannelModalOpen(false)}
              channels={availableChannels}
            />
          )}
          {editTriggerNodeId && (() => {
            const tn = (workflow.trigger_nodes || []).find((n) => n.id === editTriggerNodeId);
            return tn ? (
              <TriggerNodeEditModal
                node={tn}
                onChange={(updated) => {
                  const nodes = (workflow.trigger_nodes || []).map((n) => n.id === updated.id ? updated : n);
                  setWorkflow({ ...workflow, trigger_nodes: nodes });
                }}
                onRemove={() => {
                  setWorkflow({ ...workflow, trigger_nodes: (workflow.trigger_nodes || []).filter((n) => n.id !== editTriggerNodeId) });
                }}
                onClose={() => setEditTriggerNodeId(null)}
              />
            ) : null;
          })()}
          {editOrcheNodeId && (
            <OrcheNodeEditModal
              workflow={workflow}
              nodeId={editOrcheNodeId}
              onChange={setWorkflow}
              onClose={() => setEditOrcheNodeId(null)}
              nodeOptions={nodeOptions}
            />
          )}
          {editSubNodeId && (
            <AgentEditModal
              workflow={workflow}
              subNodeId={editSubNodeId}
              onChange={setWorkflow}
              onClose={() => setEditSubNodeId(null)}
              backends={nodeOptions.backends}
            />
          )}
        </div>
      ) : tab === "builder" ? (
        <FormBuilder workflow={workflow} onChange={setWorkflow} backends={nodeOptions.backends} />
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
        <h4 className="builder-preview-title">{t("workflows.preview")}</h4>
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
  useModalEffects(true, onClose);
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
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{phase.title || phase.phase_id}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
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
          <div className="builder-meta-hint">
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

// ── Cron 편집 모달 ──

/** @deprecated 하위 호환용. trigger_nodes로 대체됨. */
type TriggerDef = { type: "cron"; schedule: string; timezone?: string };

function CronEditModal({ trigger, onChange, onRemove, onClose }: {
  trigger?: TriggerDef;
  onChange: (t: TriggerDef) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const [schedule, setSchedule] = useState(trigger?.schedule || "0 9 * * *");
  const [timezone, setTimezone] = useState(trigger?.timezone || "");

  const handleSave = () => {
    const val: TriggerDef = { type: "cron", schedule };
    if (timezone) val.timezone = timezone;
    onChange(val);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{t("workflows.node_cron")}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.cron_schedule")}</label>
            <input className="input input--sm" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.timezone")}</label>
            <input className="input input--sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Seoul" />
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => { onRemove(); onClose(); }}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={handleSave}>
            {t("workflows.save_template")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Trigger Node 편집 모달 ──

type TriggerType = "cron" | "webhook" | "manual" | "channel_message";
const TRIGGER_TYPES: TriggerType[] = ["cron", "webhook", "manual", "channel_message"];
const TRIGGER_LABELS: Record<TriggerType, string> = {
  cron: "⏰ Cron", webhook: "↗ Webhook", manual: "▶ Manual", channel_message: "💬 Channel",
};

function TriggerNodeEditModal({ node, onChange, onRemove, onClose }: {
  node: TriggerNodeDef;
  onChange: (n: TriggerNodeDef) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const [triggerType, setTriggerType] = useState<TriggerType>(node.trigger_type);
  const [schedule, setSchedule] = useState(node.schedule || "0 9 * * *");
  const [timezone, setTimezone] = useState(node.timezone || "");
  const [webhookPath, setWebhookPath] = useState(node.webhook_path || "");
  const [channelType, setChannelType] = useState(node.channel_type || "slack");
  const [chatId, setChatId] = useState(node.chat_id || "");

  const handleSave = () => {
    const updated: TriggerNodeDef = { id: node.id, trigger_type: triggerType };
    if (triggerType === "cron") { updated.schedule = schedule; if (timezone) updated.timezone = timezone; }
    if (triggerType === "webhook") { updated.webhook_path = webhookPath; }
    if (triggerType === "channel_message") { updated.channel_type = channelType; if (chatId) updated.chat_id = chatId; }
    onChange(updated);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{t("workflows.trigger_node")}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.trigger_type")}</label>
            <div className="builder-btn-row">
              {TRIGGER_TYPES.map((tt) => (
                <button key={tt} className={`btn btn--sm${triggerType === tt ? " btn--accent" : ""}`}
                  onClick={() => setTriggerType(tt)}>{TRIGGER_LABELS[tt]}</button>
              ))}
            </div>
          </div>
          {triggerType === "cron" && (<>
            <div className="builder-row">
              <label className="label">{t("workflows.cron_schedule")}</label>
              <input className="input input--sm" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * *" />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.timezone")}</label>
              <input className="input input--sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Seoul" />
            </div>
          </>)}
          {triggerType === "webhook" && (
            <div className="builder-row">
              <label className="label">{t("workflows.webhook_path")}</label>
              <input className="input input--sm" value={webhookPath} onChange={(e) => setWebhookPath(e.target.value)} placeholder="/hooks/my-workflow" />
            </div>
          )}
          {triggerType === "channel_message" && (<>
            <div className="builder-row">
              <label className="label">{t("workflows.channel_type")}</label>
              <input className="input input--sm" value={channelType} onChange={(e) => setChannelType(e.target.value)} placeholder="slack" />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.channel_chat_id")}</label>
              <input className="input input--sm" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="C01234567" />
            </div>
          </>)}
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => { onRemove(); onClose(); }}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={handleSave}>
            {t("workflows.save_template")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Channel 편집 모달 ──

type HitlChannelDef = { channel_type: string; chat_id?: string };

function ChannelEditModal({ channel, onChange, onRemove, onClose, channels }: {
  channel?: HitlChannelDef;
  onChange: (c: HitlChannelDef) => void;
  onRemove: () => void;
  onClose: () => void;
  channels: ChannelInstanceInfo[];
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const [selectedId, setSelectedId] = useState(channel ? `${channel.channel_type}:${channel.chat_id || ""}` : "");
  const [chatId, setChatId] = useState(channel?.chat_id || "");

  const handleSelect = (val: string) => {
    setSelectedId(val);
    const match = channels.find((c) => c.instance_id === val);
    if (match) {
      setChatId("");
    }
  };

  const handleSave = () => {
    const match = channels.find((c) => c.instance_id === selectedId);
    const channel_type = match?.provider || selectedId.split(":")[0] || "slack";
    const val: HitlChannelDef = { channel_type };
    if (chatId) val.chat_id = chatId;
    onChange(val);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{t("workflows.node_channel")}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">{t("workflows.node_channel")}</label>
            <select className="input input--sm" value={selectedId} onChange={(e) => handleSelect(e.target.value)}>
              <option value="">-- Select --</option>
              {channels.map((ch) => (
                <option key={ch.instance_id} value={ch.instance_id}>
                  {ch.label} ({ch.provider}{ch.running ? "" : " - offline"})
                </option>
              ))}
            </select>
          </div>
          <div className="builder-row">
            <label className="label">Chat ID</label>
            <input className="input input--sm" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="C1234567" />
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={() => { onRemove(); onClose(); }}>
            {t("workflows.remove_phase")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={handleSave}>
            {t("workflows.save_template")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 오케스트레이션 노드 편집 모달 ──

function OrcheNodeEditModal({ workflow, nodeId, onChange, onClose, nodeOptions }: {
  workflow: WorkflowDef;
  nodeId: string;
  onChange: (w: WorkflowDef) => void;
  onClose: () => void;
  nodeOptions?: Record<string, unknown>;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const nodes = workflow.orche_nodes || [];
  const idx = nodes.findIndex((n) => n.node_id === nodeId);
  if (idx < 0) return null;
  const node = nodes[idx]!;

  const update = (patch: Partial<OrcheNodeDef>) => {
    const updated = [...nodes];
    updated[idx] = { ...updated[idx]!, ...patch } as OrcheNodeDef;
    onChange({ ...workflow, orche_nodes: updated });
  };

  const remove = () => {
    onChange({ ...workflow, orche_nodes: nodes.filter((_, i) => i !== idx) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{node.node_type.toUpperCase()}: {node.title}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <div className="builder-row">
            <label className="label">Node ID</label>
            <input className="input input--sm" value={node.node_id} onChange={(e) => update({ node_id: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.phase_title")}</label>
            <input className="input input--sm" value={node.title} onChange={(e) => update({ title: e.target.value })} />
          </div>
          <div className="builder-row">
            <label className="label">depends_on</label>
            <input
              className="input input--sm"
              value={(node.depends_on || []).join(", ")}
              onChange={(e) => update({ depends_on: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="node-1, phase-1"
            />
          </div>

          {/* 노드 타입별 편집 패널 — registry에서 조회 */}
          {(() => {
            const desc = get_frontend_node(node.node_type);
            return desc?.EditPanel
              ? <desc.EditPanel node={node as Record<string, unknown>} update={update as (p: Record<string, unknown>) => void} t={t} options={nodeOptions} />
              : null;
          })()}
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm btn--danger" onClick={remove}>{t("workflows.remove_phase")}</button>
          <button className="btn btn--sm" onClick={onClose}>{t("workflows.close")}</button>
        </div>
      </div>
    </div>
  );
}

// ── 클러스터 Sub-node (Agent/Critic) 편집 모달 ──

type BackendOption = { value: string; label: string };

function AgentEditModal({ workflow, subNodeId, onChange, onClose, backends }: {
  workflow: WorkflowDef;
  subNodeId: string;
  onChange: (w: WorkflowDef) => void;
  onClose: () => void;
  backends?: BackendOption[];
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const { data: roles } = useQuery<RolePreset[]>({
    queryKey: ["workflow-roles"],
    queryFn: () => api.get("/api/workflow/roles"),
    staleTime: 60_000,
  });

  // subNodeId 형식: "{phaseId}__{agentId}" 또는 "{phaseId}__critic"
  const sep = subNodeId.indexOf("__");
  if (sep < 0) return null;
  const phaseId = subNodeId.slice(0, sep);
  const subId = subNodeId.slice(sep + 2);
  const isCritic = subId === "critic";

  const phaseIdx = workflow.phases.findIndex((p) => p.phase_id === phaseId);
  if (phaseIdx < 0) return null;
  const phase = workflow.phases[phaseIdx]!;

  if (isCritic) {
    if (!phase.critic) return null;
    const critic = phase.critic;
    const updateCritic = (patch: Partial<CriticDef>) => {
      const phases = [...workflow.phases];
      phases[phaseIdx] = { ...phase, critic: { ...critic, ...patch } };
      onChange({ ...workflow, phases });
    };
    return (
      <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
        <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <h3 className="modal__title">Critic — {phase.title}</h3>
            <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
          </div>
          <div className="modal__body">
            <div className="builder-row-pair">
              <div className="builder-row">
                <label className="label">{t("workflows.backend")}</label>
                <select className="input input--sm" value={critic.backend} onChange={(e) => updateCritic({ backend: e.target.value })}>
                  {(backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.model")}</label>
                <input className="input input--sm" value={critic.model || ""} placeholder="auto" onChange={(e) => updateCritic({ model: e.target.value || undefined })} />
              </div>
            </div>
            <div className="builder-row-pair">
              <div className="builder-row">
                <label className="label">Gate</label>
                <select className="input input--sm" value={critic.gate ? "true" : "false"} onChange={(e) => updateCritic({ gate: e.target.value === "true" })}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div className="builder-row">
                <label className="label">{t("workflows.on_rejection")}</label>
                <select className="input input--sm" value={critic.on_rejection || ""} onChange={(e) => updateCritic({ on_rejection: e.target.value || undefined })}>
                  <option value="">-</option>
                  {REJECTION_POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.system_prompt")}</label>
              <textarea className="input input--sm" rows={4} value={critic.system_prompt} onChange={(e) => updateCritic({ system_prompt: e.target.value })} />
            </div>
          </div>
          <div className="modal__footer">
            <button className="btn btn--sm" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  // Agent 편집
  const agentIdx = phase.agents.findIndex((a) => a.agent_id === subId);
  if (agentIdx < 0) return null;
  const agent = phase.agents[agentIdx]!;

  const updateAgent = (patch: Partial<AgentDef>) => {
    const phases = [...workflow.phases];
    const agents = [...phase.agents];
    agents[agentIdx] = { ...agent, ...patch };
    phases[phaseIdx] = { ...phase, agents };
    onChange({ ...workflow, phases });
  };

  const applyRole = (roleId: string) => {
    const preset = roles?.find((r) => r.id === roleId);
    if (!preset) { updateAgent({ role: roleId }); return; }
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

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Agent: {agent.label || agent.agent_id}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <div className="builder-row-pair">
            <div className="builder-row">
              <label className="label">Agent ID</label>
              <input className="input input--sm" value={agent.agent_id} onChange={(e) => updateAgent({ agent_id: e.target.value })} />
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.agent_label")}</label>
              <input className="input input--sm" value={agent.label} onChange={(e) => updateAgent({ label: e.target.value })} />
            </div>
          </div>
          {/* Role 태그 칩 선택 */}
          <div className="builder-row">
            <label className="label">{t("workflows.agent_role")}</label>
            <div className="role-chips">
              {roles?.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`role-chip${agent.role === r.id ? " role-chip--active" : ""}`}
                  onClick={() => applyRole(r.id)}
                  title={r.description}
                >
                  {r.name}
                </button>
              ))}
              <input
                className="role-chip-input"
                value={roles?.some((r) => r.id === agent.role) ? "" : agent.role}
                placeholder={t("workflows.custom_role")}
                onChange={(e) => updateAgent({ role: e.target.value })}
                onFocus={() => { if (roles?.some((r) => r.id === agent.role)) updateAgent({ role: "" }); }}
              />
            </div>
            {roles?.some((r) => r.id === agent.role) && (
              <div className="builder-accent-hint">
                {t("workflows.role_auto_prompt")}
              </div>
            )}
          </div>
          <div className="builder-row-triple">
            <div className="builder-row">
              <label className="label">{t("workflows.backend")}</label>
              <select className="input input--sm" value={agent.backend} onChange={(e) => updateAgent({ backend: e.target.value })}>
                {(backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </div>
            <div className="builder-row">
              <label className="label">{t("workflows.model")}</label>
              <input className="input input--sm" value={agent.model || ""} placeholder="auto" onChange={(e) => updateAgent({ model: e.target.value || undefined })} />
            </div>
            <div className="builder-row">
              <label className="label">Max Turns</label>
              <div className="builder-inline-row">
                <input
                  className="input input--sm flex-1"
                  type="number"
                  min={0}
                  value={agent.max_turns ?? 3}
                  onChange={(e) => updateAgent({ max_turns: Number(e.target.value) })}
                  disabled={agent.max_turns === 0}
                />
                <label className="builder-checkbox-label">
                  <input
                    type="checkbox"
                    checked={agent.max_turns === 0}
                    onChange={(e) => updateAgent({ max_turns: e.target.checked ? 0 : 10 })}
                  />
                  {t("workflows.unlimited")}
                </label>
              </div>
            </div>
          </div>
          <div className="builder-row">
            <label className="label">{t("workflows.system_prompt")}</label>
            <div className="builder-accent-hint--mb">
              {t(`workflows.prompt_hint_${phase.mode || "parallel"}`)}
            </div>
            <textarea className="input input--sm" rows={5} value={agent.system_prompt} onChange={(e) => updateAgent({ system_prompt: e.target.value })} />
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Phase Run 전 objective 입력 바. */
function NodeRunInputBar({ nodeId, onSubmit, onCancel }: {
  nodeId: string;
  onSubmit: (objective: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <div className="node-run-input-bar">
      <strong className="builder-run-label">Run: {nodeId}</strong>
      <input
        className="input input--sm flex-1"
        placeholder={t("workflows.run_objective_placeholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSubmit(value.trim()); }}
        autoFocus
      />
      <button className="btn btn--sm btn--primary" onClick={() => { if (value.trim()) onSubmit(value.trim()); }} disabled={!value.trim()}>
        {t("workflows.run_execute")}
      </button>
      <button className="btn btn--sm" onClick={onCancel}>{t("workflows.cancel")}</button>
    </div>
  );
}

/** 그래프 에디터 하단 인라인 Output 패널. */
function NodeRunOutputPanel({ result, onClose }: {
  result: { id: string; mode: string; result?: Record<string, unknown>; error?: string; loading: boolean };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const t = useT();
  const [copied, setCopied] = useState(false);
  const isTest = result.mode === "test";
  const isError = !!result.error || (result.result && !result.result.ok);
  const resp = result.result || {};

  // 주요 값 추출
  const output = resp.output ?? resp.preview ?? null;
  const duration = typeof resp.duration_ms === "number" ? resp.duration_ms : null;
  const warnings = Array.isArray(resp.warnings) ? resp.warnings as string[] : [];
  const errorMsg = result.error || (typeof resp.error === "string" ? resp.error : null);

  const displayContent = errorMsg
    || (typeof output === "string" && output.trim().length > 0 ? output : null)
    || JSON.stringify(resp, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => toast(t("workflows.copy_failed"), "err"));
  };

  return (
    <div className="node-output-panel">
      <div className="node-output-panel__header">
        <div className="builder-header__left">
          <span className={`badge ${isError ? "badge--err" : "badge--ok"}`}>
            {result.loading ? "Running..." : isError ? "Error" : "OK"}
          </span>
          <strong className="builder-run-title">
            {isTest ? "Test" : "Run"}: {result.id}
          </strong>
          {duration != null && (
            <span className="builder-run-duration">{duration}ms</span>
          )}
        </div>
        <div className="builder-btn-row">
          <button className="btn btn--xs" onClick={handleCopy} title="Copy output">
            {copied ? "✓" : "⧉"}
          </button>
          <button className="btn btn--xs" onClick={onClose} aria-label="close">✕</button>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="builder-warnings">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      <pre className="node-output-panel__body">{displayContent}</pre>
    </div>
  );
}

// ── 태그 검색/선택 공용 컴포넌트 ──

/** 단일 값 태그 검색 선택 (n8n 스타일). */
function TagSearchInput({ value, options, onChange, placeholder }: {
  value: string; options: string[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="tag-search">
      <div className="tag-search__row">
        {value && (
          <span className="tag-chip tag-chip--active">
            {value}
            <button className="tag-chip__x" onClick={() => { onChange(""); setQuery(""); }}>×</button>
          </span>
        )}
        {!value && (
          <input
            className="input input--sm tag-search__input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        )}
      </div>
      {open && !value && filtered.length > 0 && (
        <div className="tag-search__dropdown">
          {filtered.map((o) => (
            <button key={o} className="tag-search__option" onMouseDown={() => { onChange(o); setQuery(""); setOpen(false); }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 다중 태그 선택 (Phase attach_to 등). */
function MultiTagSelect({ selected, options, onChange }: {
  selected: string[]; options: { id: string; label: string }[]; onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const unselected = options.filter((o) => !selected.includes(o.id));
  return (
    <div className="multi-tag-select">
      <div className="multi-tag-select__tags">
        {selected.map((id) => {
          const opt = options.find((o) => o.id === id);
          return (
            <span key={id} className="tag-chip tag-chip--active">
              {opt?.label || id}
              <button className="tag-chip__x" onClick={() => onChange(selected.filter((s) => s !== id))}>×</button>
            </span>
          );
        })}
        {unselected.length > 0 && (
          <div className="inline-dropdown">
            <button className="tag-chip tag-chip--add" onClick={() => setOpen(!open)}>+</button>
            {open && (
              <div className="tag-search__dropdown">
                {unselected.map((o) => (
                  <button key={o.id} className="tag-search__option" onClick={() => { onChange([...selected, o.id]); setOpen(false); }}>{o.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tool/Skill 노드 편집 모달 ──

function ToolNodeEditModal({ workflow, subNodeId, onChange, onClose, availableTools, toolDefinitions }: {
  workflow: WorkflowDef; subNodeId: string;
  onChange: (w: WorkflowDef) => void; onClose: () => void;
  availableTools: string[];
  toolDefinitions: Array<Record<string, unknown>>;
}) {
  const t = useT();
  useModalEffects(true, onClose);
  // subNodeId: "{phaseId}__tool_{toolNodeId}"
  const match = subNodeId.match(/^(.+)__tool_(.+)$/);
  if (!match) return null;
  const toolNodeId = match[2]!;
  const nodes = workflow.tool_nodes || [];
  const idx = nodes.findIndex((n) => n.id === toolNodeId);
  if (idx < 0) return null;
  const node = nodes[idx]!;

  const update = (patch: Partial<ToolNodeDef>) => {
    const updated = [...nodes];
    updated[idx] = { ...node, ...patch };
    onChange({ ...workflow, tool_nodes: updated });
  };

  const remove = () => {
    onChange({ ...workflow, tool_nodes: nodes.filter((_, i) => i !== idx) });
    onClose();
  };

  // 선택된 도구의 JSON Schema에서 파라미터 추출
  const toolDef = toolDefinitions.find((d) =>
    (d as { function?: { name?: string } }).function?.name === node.tool_id
  ) as { function?: { name?: string; parameters?: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }> } } } | undefined;
  const paramSchema = toolDef?.function?.parameters?.properties || {};
  const params = node.params || {};

  const phaseOptions = workflow.phases.map((p) => ({ id: p.phase_id, label: p.title || p.phase_id }));

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">🔧 {t("workflows.edit_tool_node")}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <label className="form-label">{t("workflows.tool_id")}</label>
          <TagSearchInput value={node.tool_id} options={availableTools} onChange={(v) => update({ tool_id: v })} placeholder={t("workflows.search_tool")} />

          <label className="form-label">{t("workflows.description")}</label>
          <input className="input input--sm" value={node.description} onChange={(e) => update({ description: e.target.value })} />

          <label className="form-label">{t("workflows.attach_to_phases")}</label>
          <MultiTagSelect selected={node.attach_to || []} options={phaseOptions} onChange={(ids) => update({ attach_to: ids })} />

          {Object.keys(paramSchema).length > 0 && (
            <>
              <label className="form-label">{t("workflows.tool_params")}</label>
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
                      <input type="checkbox" checked={!!params[key]} onChange={(e) => update({ params: { ...params, [key]: e.target.checked } })} />
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
            </>
          )}
        </div>
        <div className="modal__footer modal__footer--spread">
          <button className="btn btn--sm btn--danger" onClick={remove}>{t("workflows.delete")}</button>
          <button className="btn btn--sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SkillNodeEditModal({ workflow, subNodeId, onChange, onClose, availableSkills }: {
  workflow: WorkflowDef; subNodeId: string;
  onChange: (w: WorkflowDef) => void; onClose: () => void;
  availableSkills: string[];
}) {
  const t = useT();
  useModalEffects(true, onClose);
  const match = subNodeId.match(/^(.+)__skill_(.+)$/);
  if (!match) return null;
  const skillNodeId = match[2]!;
  const nodes = workflow.skill_nodes || [];
  const idx = nodes.findIndex((n) => n.id === skillNodeId);
  if (idx < 0) return null;
  const node = nodes[idx]!;

  const update = (patch: Partial<SkillNodeDef>) => {
    const updated = [...nodes];
    updated[idx] = { ...node, ...patch };
    onChange({ ...workflow, skill_nodes: updated });
  };

  const remove = () => {
    onChange({ ...workflow, skill_nodes: nodes.filter((_, i) => i !== idx) });
    onClose();
  };

  const phaseOptions = workflow.phases.map((p) => ({ id: p.phase_id, label: p.title || p.phase_id }));

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--md" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">⚡ {t("workflows.edit_skill_node")}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <label className="form-label">{t("workflows.skill_name")}</label>
          <TagSearchInput value={node.skill_name} options={availableSkills} onChange={(v) => update({ skill_name: v })} placeholder={t("workflows.search_skill")} />

          <label className="form-label">{t("workflows.description")}</label>
          <input className="input input--sm" value={node.description} onChange={(e) => update({ description: e.target.value })} />

          <label className="form-label">{t("workflows.attach_to_phases")}</label>
          <MultiTagSelect selected={node.attach_to || []} options={phaseOptions} onChange={(ids) => update({ attach_to: ids })} />
        </div>
        <div className="modal__footer modal__footer--spread">
          <button className="btn btn--sm btn--danger" onClick={remove}>{t("workflows.delete")}</button>
          <button className="btn btn--sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── 폼 빌더 탭 ──

function FormBuilder({ workflow, onChange, backends }: { workflow: WorkflowDef; onChange: (w: WorkflowDef) => void; backends?: BackendOption[] }) {
  const t = useT();

  const { data: roles } = useQuery<RolePreset[]>({
    queryKey: ["workflow-roles"],
    queryFn: () => api.get("/api/workflow/roles"),
    staleTime: 60_000,
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
    phases[phaseIndex] = { ...p, critic: p.critic ? undefined : { backend: "", system_prompt: "", gate: true } };
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
              <span className="builder-hint">
                {(phase.mode || "parallel") === "parallel" && (t("workflows.mode_parallel_hint") || "All agents run concurrently.")}
                {phase.mode === "interactive" && (t("workflows.mode_interactive_hint") || "Agents take turns; user can respond between iterations.")}
                {phase.mode === "sequential_loop" && (t("workflows.mode_loop_hint") || "Agent loops until condition met or max iterations.")}
              </span>
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
                <div className="builder-meta-hint--mb">
                  {t("workflows.role_auto_prompt")}
                </div>
              )}
              <div className="builder-row-triple">
                <div className="builder-row">
                  <label className="label">{t("workflows.backend")}</label>
                  <select className="input input--sm" value={agent.backend} onChange={(e) => updateAgent(pi, ai, { backend: e.target.value })}>
                    {(backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.model")}</label>
                  <input className="input input--sm" value={agent.model || ""} onChange={(e) => updateAgent(pi, ai, { model: e.target.value || undefined })} />
                </div>
                <div className="builder-row">
                  <label className="label">{t("workflows.max_turns")}</label>
                  <div className="builder-inline-row">
                    <input
                      className="input input--sm flex-1"
                      type="number"
                      min={0}
                      value={agent.max_turns ?? 3}
                      onChange={(e) => updateAgent(pi, ai, { max_turns: Number(e.target.value) })}
                      disabled={agent.max_turns === 0}
                    />
                    <label className="builder-checkbox-label">
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
            <label className="builder-toggle-label">
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
                    {(backends || []).map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
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

      <button className="btn btn--sm btn--accent builder-add-phase" onClick={addPhase}>
        + {t("workflows.add_phase")}
      </button>
    </div>
  );
}
