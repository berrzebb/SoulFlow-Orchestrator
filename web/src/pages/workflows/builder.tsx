import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import { api } from "../../api/client";

import { useToast } from "../../components/toast";
import { YamlEditor } from "../../components/yaml-editor";
import { NodePalette } from "../../components/node-palette";
import { useT } from "../../i18n";
import { GraphEditor, type WorkflowDef, type AgentDef, type PhaseDef, type ToolNodeDef, type SkillNodeDef, type OrcheNodeDef, type TriggerNodeDef } from "./graph-editor";
import { NodeInspector, type UpstreamRef } from "./node-inspector";
import { get_output_fields } from "./output-schema";
import { PhaseEditModal, CronEditModal, TriggerNodeEditModal, ChannelEditModal, OrcheNodeEditModal, AgentEditModal } from "./builder-modals";
import { WorkflowPromptBar, NodeRunInputBar } from "./builder-bars";

/** /api/tools 응답. */
type ToolsApiResponse = { names: string[]; definitions: Array<Record<string, unknown>>; mcp_servers: Array<{ name: string; tools: string[] }> };
/** /api/skills 응답 (간략). */
type SkillListItem = { name: string; summary?: string; source?: string };
/** /api/channels/instances 응답 항목. */
type ChannelInstanceInfo = { instance_id: string; provider: string; label: string; enabled: boolean; running: boolean };
/** /api/agents/providers 응답 항목 (간략). */
type ProviderInfo = { instance_id: string; label: string; enabled: boolean; available: boolean; provider_type?: string };
/** /api/agents/providers/:id/models 응답 항목. */
type ProviderModelInfo = { id: string; name: string; provider: string; purpose: "chat" | "embedding" | "both" };
/** 프로바이더 모델 캐시 — 컴포넌트 외부에서 단일 인스턴스로 유지 (useRef 불필요). */
const _providerModelsCache = new Map<string, { data: ProviderModelInfo[]; ts: number }>();

function empty_agent(index: number, defaultBackend = ""): AgentDef {
  return { agent_id: `agent-${index + 1}`, role: "", label: "", backend: defaultBackend, system_prompt: "", max_turns: 3 };
}

function empty_phase(index: number, defaultBackend = ""): PhaseDef {
  return { phase_id: `phase-${index + 1}`, title: "", agents: [empty_agent(0, defaultBackend)] };
}

function empty_workflow(): WorkflowDef {
  return { title: "", objective: "{{objective}}", phases: [empty_phase(0)] };
}

// ── Page ──

export default function WorkflowBuilderPage() {
  const { name } = useParams<{ name: string }>();
  const isNew = !name || name === "new";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPrompt = isNew ? (searchParams.get("prompt") ?? undefined) : undefined;
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();

  const [workflow, setWorkflowRaw] = useState<WorkflowDef>(empty_workflow);
  // Undo/Redo 히스토리
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const MAX_HISTORY = 50;
  const setWorkflow = useCallback((next: WorkflowDef) => {
    setWorkflowRaw((prev) => {
      const h = historyRef.current;
      h.past.push(JSON.stringify(prev));
      if (h.past.length > MAX_HISTORY) h.past.shift();
      h.future = [];
      return next;
    });
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h.past.length) return;
    setWorkflowRaw((prev) => {
      h.future.push(JSON.stringify(prev));
      const restored = JSON.parse(h.past.pop()!) as WorkflowDef;
      return restored;
    });
  }, []);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h.future.length) return;
    setWorkflowRaw((prev) => {
      h.past.push(JSON.stringify(prev));
      const restored = JSON.parse(h.future.pop()!) as WorkflowDef;
      return restored;
    });
  }, []);
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState("");
  const [templateName, setTemplateName] = useState(name || "");
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [editPhaseId, setEditPhaseId] = useState<string | null>(null);
  const [cronModalOpen, setCronModalOpen] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteBtnRef = useRef<HTMLButtonElement>(null);
  const [yamlSideOpen, setYamlSideOpen] = useState(false);
  const [yamlSideWidth, setYamlSideWidth] = useState<number | null>(null);
  const [yamlSideDirty, setYamlSideDirty] = useState(false);
  const yamlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editOrcheNodeId, setEditOrcheNodeId] = useState<string | null>(null);
  const [editSubNodeId, setEditSubNodeId] = useState<string | null>(null);
  const [editTriggerNodeId, setEditTriggerNodeId] = useState<string | null>(null);
  const [nodeRunResult, setNodeRunResult] = useState<{ id: string; mode: string; result?: Record<string, unknown>; error?: string; loading: boolean } | null>(null);
  /** 우측 인스펙터 패널 대상 노드. */
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  /** 저장 상태 시각화 (펄스 효과용). */
  const [saveStatusPulse, setSaveStatusPulse] = useState<"success" | "error" | null>(null);

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

  /** 프로바이더 instance_id로 해당 프로바이더의 모델 목록을 조회 — 모듈 캐시 사용. */
  const fetchProviderModels = useCallback(async (instance_id: string): Promise<ProviderModelInfo[]> => {
    const cached = _providerModelsCache.get(instance_id);
    if (cached && Date.now() - cached.ts < 60_000) return cached.data;
    try {
      const models = await api.get<ProviderModelInfo[]>(`/api/agents/providers/${encodeURIComponent(instance_id)}/models`);
      _providerModelsCache.set(instance_id, { data: models, ts: Date.now() });
      return models;
    } catch { return []; }
  }, []);
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
  const { data: kanbanBoardsData } = useQuery<{ board_id: string; name: string }[]>({
    queryKey: ["kanban-boards"],
    queryFn: () => api.get("/api/kanban/boards"),
    staleTime: 60_000,
  });

  const availableTools: string[] = toolsData?.names || [];
  const availableSkills: string[] = (skillsData || []).map((s) => s.name);
  const availableChannels = (channelsData || []).filter((c) => c.enabled);

  /** 노드 편집 패널에 전달할 동적 옵션. */
  const nodeOptions = {
    backends: (providersData || []).filter((p) => p.enabled).map((p) => ({ value: p.instance_id, label: p.label || p.instance_id, available: p.available, provider_type: p.provider_type })),
    models: modelsData || [],
    fetch_provider_models: fetchProviderModels,
    oauth_integrations: (oauthData || []).filter((o) => o.enabled),
    workflow_templates: wfTemplatesData || [],
    channels: (channelsData || []).filter((c) => c.enabled).map((c) => ({
      provider: c.provider, channel_id: c.instance_id, label: c.label, enabled: c.enabled,
    })),
    available_tools: availableTools,
    tool_definitions: (toolsData?.definitions || []) as Array<Record<string, unknown>>,
    available_skills: availableSkills,
    kanban_boards: kanbanBoardsData || [],
    workflow_nodes: [
      ...workflow.phases.map((p) => ({ id: p.phase_id, label: p.title || p.phase_id, type: "phase" })),
      ...(workflow.orche_nodes || []).map((n) => ({ id: n.node_id, label: n.title || n.node_id, type: n.node_type })),
    ],
  };

  // 기존 템플릿 로드
  const { data: existing } = useQuery<WorkflowDef>({
    queryKey: ["workflow-template", name],
    queryFn: () => api.get(`/api/workflow/templates/${encodeURIComponent(name!)}`),
    enabled: !isNew,
  });

  const loadedNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!existing) return;
    // 같은 name에 대해 이미 로드했으면 재설정 방지 (저장 후 refetch로 덮어쓰기 방지)
    if (loadedNameRef.current === (name || "")) return;
    loadedNameRef.current = name || "";
    setWorkflowRaw(existing);
    historyRef.current = { past: [], future: [] };
    setTemplateName(name || existing.title);
    setYamlSideDirty(false);
  }, [existing, name]);

  // 새 워크플로우에서 백엔드 미지정 에이전트에 기본 백엔드 적용 (렌더 타임)
  const [defaultBackendApplied, setDefaultBackendApplied] = useState(false);
  if (!defaultBackendApplied && isNew) {
    const defaultBackend = nodeOptions.backends[0]?.value;
    if (defaultBackend && workflow.phases.some((p) => p.agents.some((a) => !a.backend))) {
      setDefaultBackendApplied(true);
      setWorkflowRaw((prev) => ({
        ...prev,
        phases: prev.phases.map((p) => ({
          ...p,
          agents: p.agents.map((a) => a.backend ? a : { ...a, backend: defaultBackend }),
        })),
      }));
    }
  }

  // workflow → YAML 문자열 (메모화). yamlSideDirty=false이면 이 값을 에디터에 직접 표시
  const yamlFromWorkflow = useMemo(() => {
    try { return yaml.dump(workflow, { lineWidth: -1, noRefs: true }); } catch { return ""; }
  }, [workflow]);
  // 사용자가 편집 중이 아닐 때는 workflow 변경을 에디터에 실시간 반영
  const effectiveYamlText = yamlSideOpen && !yamlSideDirty ? yamlFromWorkflow : yamlText;

  const yamlTextRef = useRef(yamlText);
  useEffect(() => { yamlTextRef.current = yamlText; }, [yamlText]);

  const sync_form_from_yaml = () => {
    try {
      const parsed = yaml.load(yamlTextRef.current) as WorkflowDef;
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

  // 저장
  const saveMut = useMutation({
    mutationFn: (data: { name: string; def: WorkflowDef }) =>
      api.put<{ ok: boolean; name: string }>(`/api/workflow/templates/${encodeURIComponent(data.name)}`, data.def),
    onSuccess: (result) => {
      toast(t("workflows.template_saved"), "ok");
      setSaveStatusPulse("success");
      setTimeout(() => setSaveStatusPulse(null), 2000);
      void qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      // 단일 템플릿 캐시를 현재 데이터로 업데이트 — refetch로 인한 되돌림 방지
      const slug = result.name || templateName || workflow.title || "untitled";
      qc.setQueryData(["workflow-template", slug], workflow);
      if (isNew && result.name) {
        loadedNameRef.current = result.name;
        navigate(`/workflows/edit/${encodeURIComponent(result.name)}`, { replace: true });
      }
    },
    onError: (err: unknown) => {
      const api_err = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const msg = api_err?.response?.data?.error?.message || t("workflows.save_failed");
      toast(msg, "err");
      setSaveStatusPulse("error");
      setTimeout(() => setSaveStatusPulse(null), 3000);
    },
  });

  const handleSave = () => {
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
    onError: (err: unknown) => {
      const api_err = err as { response?: { data?: { error?: { message?: string } } } };
      const msg = api_err?.response?.data?.error?.message || t("workflows.run_failed");
      toast(msg, "err");
    },
  });

  const handleRun = () => {
    runMut.mutate({
      title: workflow.title, objective: workflow.objective, phases: workflow.phases,
      orche_nodes: workflow.orche_nodes, field_mappings: workflow.field_mappings,
      tool_nodes: workflow.tool_nodes, skill_nodes: workflow.skill_nodes,
      trigger: workflow.trigger, hitl_channel: workflow.hitl_channel,
    });
  };

  /** Run 전 입력 프롬프트 상태: Phase 노드 Run 시 objective 입력용. */
  const [runInputPrompt, setRunInputPrompt] = useState<{ id: string; node: Record<string, unknown> } | null>(null);

  /** 노드 실행 API 호출. */
  const executeNode = async (id: string, mode: "run" | "test", node: Record<string, unknown>, input_memory: Record<string, unknown>, provider_instance_id?: string, model?: string) => {
    setNodeRunResult({ id, mode, loading: true });
    try {
      const endpoint = mode === "test" ? "/api/workflow/node/tests" : "/api/workflow/node/runs";
      const body: Record<string, unknown> = { node, input_memory };
      if (provider_instance_id) body.provider_instance_id = provider_instance_id;
      if (model) body.model = model;
      const result = await api.post<Record<string, unknown>>(endpoint, body);
      setNodeRunResult({ id, mode, result, loading: false });
      setInspectorNodeId(id);
      toast(mode === "test" ? t("workflows.test_node_done") : t("workflows.run_node_done"), "ok");
    } catch (e) {
      const api_err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = api_err?.response?.data?.error?.message || api_err?.message || String(e);
      setNodeRunResult({ id, mode, error: errorMsg, loading: false });
      setInspectorNodeId(id);
      toast(errorMsg || t("workflows.node_run_error"), "err");
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

  /** NodePalette에서 도구 선택. */
  const handleSelectTool = (tool_id: string, description: string) => {
    const idx = (workflow.tool_nodes?.length || 0) + 1;
    const newNode: ToolNodeDef = {
      id: `tool-${idx}`,
      tool_id,
      description,
      attach_to: workflow.phases[0]?.phase_id ? [workflow.phases[0].phase_id] : [],
    };
    setWorkflow({ ...workflow, tool_nodes: [...(workflow.tool_nodes || []), newNode] });
    setPaletteOpen(false);
    // Select newly added node in inspector
    setTimeout(() => setInspectorNodeId(`${workflow.phases[0]?.phase_id}__tool_${newNode.id}`), 0);
  };

  /** NodePalette에서 스킬 선택. */
  const handleSelectSkill = (skill_name: string, description: string) => {
    const idx = (workflow.skill_nodes?.length || 0) + 1;
    const newNode: SkillNodeDef = {
      id: `skill-${idx}`,
      skill_name,
      description,
      attach_to: workflow.phases[0]?.phase_id ? [workflow.phases[0].phase_id] : [],
    };
    setWorkflow({ ...workflow, skill_nodes: [...(workflow.skill_nodes || []), newNode] });
    setPaletteOpen(false);
    // Select newly added node in inspector
    setTimeout(() => setInspectorNodeId(`${workflow.phases[0]?.phase_id}__skill_${newNode.id}`), 0);
  };

  /** inspectorNodeId에서 노드 데이터·타입·라벨·update 콜백을 resolve. */
  const resolveInspectorNode = (id: string): {
    node: Record<string, unknown>; node_type: string; node_label: string;
    onUpdate: (partial: Record<string, unknown>) => void;
  } | null => {
    // Sub-node: "{phaseId}__{agentId}" 또는 "{phaseId}__critic"
    const sep = id.indexOf("__");
    if (sep >= 0) {
      const parentId = id.slice(0, sep);
      const subId = id.slice(sep + 2);

      // End 서브노드: "{endNodeId}__end_{target}"
      if (subId.startsWith("end_")) {
        const target = subId.slice(4); // "channel", "media", "webhook", "http"
        const endNode = (workflow.end_nodes || []).find((en) => en.node_id === parentId);
        if (!endNode) return null;
        const targetConfig = endNode.target_config?.[target] || {};
        return {
          node: targetConfig as Record<string, unknown>,
          node_type: `end_${target}`,
          node_label: `End: ${target}`,
          onUpdate: (partial) => {
            const end_nodes = (workflow.end_nodes || []).map((en) => {
              if (en.node_id !== parentId) return en;
              const prev = en.target_config || {};
              return { ...en, target_config: { ...prev, [target]: { ...(prev[target] || {}), ...partial } } };
            });
            setWorkflow({ ...workflow, end_nodes });
          },
        };
      }

      const phase = workflow.phases.find((p) => p.phase_id === parentId);
      if (!phase) return null;
      // Tool sub-node
      if (subId.startsWith("tool_")) {
        const toolNodeId = subId.slice(5);
        const toolNode = (workflow.tool_nodes || []).find((n) => n.id === toolNodeId);
        if (!toolNode) return null;
        return {
          node: toolNode as unknown as Record<string, unknown>,
          node_type: "tool_sub",
          node_label: toolNode.tool_id || toolNode.id,
          onUpdate: (partial) => {
            const nodes = (workflow.tool_nodes || []).map((n) => n.id === toolNodeId ? { ...n, ...partial } as ToolNodeDef : n);
            setWorkflow({ ...workflow, tool_nodes: nodes });
          },
        };
      }
      // Skill sub-node
      if (subId.startsWith("skill_")) {
        const skillNodeId = subId.slice(6);
        const skillNode = (workflow.skill_nodes || []).find((n) => n.id === skillNodeId);
        if (!skillNode) return null;
        return {
          node: skillNode as unknown as Record<string, unknown>,
          node_type: "skill_sub",
          node_label: skillNode.skill_name || skillNode.id,
          onUpdate: (partial) => {
            const nodes = (workflow.skill_nodes || []).map((n) => n.id === skillNodeId ? { ...n, ...partial } as SkillNodeDef : n);
            setWorkflow({ ...workflow, skill_nodes: nodes });
          },
        };
      }
      if (subId === "critic" && phase.critic) {
        const pi = workflow.phases.findIndex((p) => p.phase_id === parentId);
        return {
          node: phase.critic as unknown as Record<string, unknown>,
          node_type: "critic",
          node_label: `Critic — ${phase.title}`,
          onUpdate: (partial) => {
            const phases = [...workflow.phases];
            phases[pi] = { ...phase, critic: { ...phase.critic!, ...partial } } as PhaseDef;
            setWorkflow({ ...workflow, phases });
          },
        };
      }
      const agent = phase.agents.find((a) => a.agent_id === subId);
      if (agent) {
        const pi = workflow.phases.findIndex((p) => p.phase_id === parentId);
        const ai = phase.agents.indexOf(agent);
        return {
          node: agent as unknown as Record<string, unknown>,
          node_type: "agent",
          node_label: agent.label || agent.agent_id,
          onUpdate: (partial) => {
            const phases = [...workflow.phases];
            const agents = [...phase.agents];
            agents[ai] = { ...agents[ai]!, ...partial } as AgentDef;
            phases[pi] = { ...phase, agents };
            setWorkflow({ ...workflow, phases });
          },
        };
      }
    }
    // Trigger node
    const tn = (workflow.trigger_nodes || []).find((n) => n.id === id);
    if (tn) {
      // 구버전 trigger_type 정규화: "channel" → "channel_message", "kanban" → "kanban_event"
      const TRIGGER_TYPE_ALIASES: Record<string, string> = { channel: "channel_message", kanban: "kanban_event" };
      const trigger_type = TRIGGER_TYPE_ALIASES[tn.trigger_type] ?? tn.trigger_type;
      const node_data = trigger_type !== tn.trigger_type ? { ...tn, trigger_type } as TriggerNodeDef : tn;
      return {
        node: node_data as unknown as Record<string, unknown>,
        node_type: `trigger_${trigger_type}`,
        node_label: `Trigger: ${trigger_type}`,
        onUpdate: (partial) => {
          const nodes = (workflow.trigger_nodes || []).map((n) => n.id === id ? { ...node_data, ...partial } as TriggerNodeDef : n);
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
    // End node
    const endNode = (workflow.end_nodes || []).find((en) => en.node_id === id);
    if (endNode) {
      return {
        node: endNode as unknown as Record<string, unknown>,
        node_type: "end",
        node_label: "End",
        onUpdate: (partial) => {
          const end_nodes = (workflow.end_nodes || []).map((en) => en.node_id === id ? { ...en, ...partial } : en);
          setWorkflow({ ...workflow, end_nodes });
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
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <a className="breadcrumb__link" href="#/workflows">{t("nav.workflows")}</a>
            <span className="breadcrumb__sep" aria-hidden="true">/</span>
            <span className="breadcrumb__current">{isNew ? t("workflows.new_workflow") : (name ?? "")}</span>
          </nav>
          <input
            className="input builder-name-input"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={t("workflows.template_name")}
            aria-label={t("workflows.template_name")}
          />
        </div>
        <div className="builder-header__right">
          <button
            className={`btn btn--sm btn--ghost${yamlSideOpen ? " btn--ghost--active" : ""}`}
            onClick={() => { if (!yamlSideOpen) setYamlSideDirty(false); setYamlSideOpen(!yamlSideOpen); }}
            aria-expanded={yamlSideOpen}
            title={t("workflows.toggle_yaml")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 18l6-6-6-6" /><path d="M8 6l-6 6 6 6" />
            </svg>
            YAML
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button className="btn btn--sm btn--accent" onClick={handleSave} disabled={saveMut.isPending} aria-busy={saveMut.isPending}>
              {saveMut.isPending ? (
                <span className="btn__spinner" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                </svg>
              )}
              {saveMut.isPending ? t("workflows.saving") : t("workflows.save_template")}
            </button>
            {saveStatusPulse && (
              <span
                className={`badge badge--${saveStatusPulse === "success" ? "ok" : "err"}`}
                style={{ animation: "fade-pulse 2s ease-out" }}
                aria-live="polite"
              >
                {saveStatusPulse === "success" ? "✓ " + t("workflows.saved") : "✗ " + t("workflows.save_error")}
              </span>
            )}
          </div>
          <button className="btn btn--sm btn--ok" onClick={handleRun} disabled={runMut.isPending} aria-busy={runMut.isPending}>
            {runMut.isPending ? (
              <span className="btn__spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
            {runMut.isPending ? t("workflows.running_action") : t("workflows.run_template")}
          </button>
        </div>
      </div>

      <div className="graph-layout">
          {/* 왼쪽 접이식 YAML 패널 */}
          <div
            className={`graph-layout__yaml-side${yamlSideOpen ? " open" : ""}`}
            style={yamlSideOpen && yamlSideWidth ? { width: yamlSideWidth } : undefined}
          >
            <div className="graph-layout__yaml-side-header">
              <span>YAML</span>
              <button className="btn btn--xs btn--ghost" onClick={() => setYamlSideOpen(false)} aria-label={t("workflows.close")}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <YamlEditor
              value={effectiveYamlText}
              onChange={(v) => {
                setYamlText(v);
                setYamlSideDirty(true);
                if (yamlDebounceRef.current) clearTimeout(yamlDebounceRef.current);
                yamlDebounceRef.current = setTimeout(() => {
                  setYamlSideDirty(false);
                  sync_form_from_yaml();
                }, 800);
              }}
              className="graph-layout__yaml-cm"
            />
            {yamlError && (
              <div className="yaml-error-banner" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8v4M12 16h.01" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div>
                  <strong>{t("workflows.yaml_error")}</strong>
                  <p>{yamlError}</p>
                </div>
              </div>
            )}
          </div>
          {/* YAML 패널 리사이즈 핸들 */}
          {yamlSideOpen && (
            <div
              className="yaml-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startW = yamlSideWidth || 340;
                const onMove = (ev: MouseEvent) => {
                  const w = Math.max(220, Math.min(800, startW + (ev.clientX - startX)));
                  setYamlSideWidth(w);
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
          )}
          {/* 메인 그래프 영역 */}
          <div className="graph-layout__main">
            {/* 프롬프트 바: 상단에 위치 (모바일/데스크탑 모두 접근 가능) */}
            <WorkflowPromptBar name={templateName || undefined} workflow={workflow} onApply={setWorkflow} initialPrompt={initialPrompt} />
            {/* 보조 노드 추가 toolbar */}
            <div className="ws-toolbar" style={{ position: "relative" }}>
              <button
                ref={paletteBtnRef}
                className="btn btn--xs btn--ghost"
                onClick={() => setPaletteOpen(true)}
                aria-label={t("palette.open_tools_skills")}
                title={t("palette.open_tools_skills")}
              >
                <span>⚡ + Tool / Skill</span>
              </button>
              {paletteOpen && (
                <NodePalette
                  tools={toolsData || { names: [], definitions: [], mcp_servers: [] }}
                  skills={skillsData || []}
                  onSelectTool={handleSelectTool}
                  onSelectSkill={handleSelectSkill}
                  onClose={() => setPaletteOpen(false)}
                />
              )}
            </div>
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
                onSubmit={(objective, provider_instance_id, model) => {
                  const { id, node } = runInputPrompt;
                  setRunInputPrompt(null);
                  void executeNode(id, "run", node, { objective }, provider_instance_id, model);
                }}
                onCancel={() => setRunInputPrompt(null)}
              />
            )}
          </div>
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
              onNodeIdChange={setInspectorNodeId}
            />
          )}
          {editPhaseId && (
            <PhaseEditModal
              workflow={workflow}
              phaseId={editPhaseId}
              onChange={setWorkflow}
              onPhaseIdChange={setEditPhaseId}
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
              onNodeIdChange={setEditOrcheNodeId}
              nodeOptions={nodeOptions}
            />
          )}
          {editSubNodeId && (
            <AgentEditModal
              workflow={workflow}
              subNodeId={editSubNodeId}
              onChange={setWorkflow}
              onClose={() => setEditSubNodeId(null)}
              onSubNodeIdChange={setEditSubNodeId}
              backends={nodeOptions.backends}
            />
          )}
      </div>
    </div>
  );
}

