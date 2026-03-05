import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ApprovalBanner } from "../../components/approval-banner";
import { Badge } from "../../components/badge";
import { MessageBubble } from "../../components/message-bubble";
import { useToast } from "../../components/toast";
import { useApprovals } from "../../hooks/use-approvals";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";

interface PhaseMessage {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
}

interface PhaseAgentState {
  agent_id: string;
  role: string;
  label: string;
  model: string;
  status: string;
  result?: string;
  error?: string;
  messages: PhaseMessage[];
}

interface PhaseCriticState {
  agent_id: string;
  model: string;
  status: string;
  review?: string;
  approved?: boolean;
  messages: PhaseMessage[];
}

interface PhaseState {
  phase_id: string;
  title: string;
  status: string;
  agents: PhaseAgentState[];
  critic?: PhaseCriticState;
  mode?: "parallel" | "interactive" | "sequential_loop";
  loop_iteration?: number;
  loop_results?: string[];
  pending_user_input?: boolean;
}

interface PhaseDefinitionBrief {
  phase_id: string;
  mode?: "parallel" | "interactive" | "sequential_loop";
  max_loop_iterations?: number;
}

interface PhaseLoopState {
  workflow_id: string;
  title: string;
  objective: string;
  status: string;
  current_phase: number;
  phases: PhaseState[];
  memory: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  definition?: { phases: PhaseDefinitionBrief[] };
}

const STATUS_VARIANT: Record<string, "ok" | "warn" | "err" | "off"> = {
  running: "ok", completed: "ok", failed: "err", cancelled: "off",
  waiting_user_input: "warn", pending: "off", reviewing: "warn",
};

const DESK_CLS: Record<string, string> = {
  running: "desk--ok", completed: "desk--ok", failed: "desk--err",
  cancelled: "desk--off", pending: "desk--off", reviewing: "desk--warn",
  waiting_user_input: "desk--warn",
};

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const [chatTarget, setChatTarget] = useState<{
    phase_id: string; agent_id: string; label: string; model?: string; status?: string; phase_title?: string;
  } | null>(null);

  const { data: wf, isLoading } = useQuery<PhaseLoopState>({
    queryKey: ["workflow", id],
    queryFn: () => api.get(`/api/workflows/${id}`),
    refetchInterval: 3_000,
    enabled: !!id,
  });

  if (isLoading || !wf) {
    return (
      <div className="page">
        <div className="skeleton skeleton-card" style={{ height: 40, width: 120, marginBottom: "var(--sp-3)" }} />
        <div className="skeleton skeleton-card" style={{ height: 200, marginBottom: "var(--sp-4)" }} />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );
  }

  const total_agents = wf.phases.reduce((n, p) => n + p.agents.length, 0);
  const done_agents = wf.phases.reduce((n, p) => n + p.agents.filter((a) => a.status === "completed").length, 0);

  return (
    <div className="page">
      <div className="wf-detail">
        <div className="wf-detail__main">
          <button className="btn btn--sm" onClick={() => navigate("/workflows")} style={{ marginBottom: "var(--sp-3)" }}>
            ← {t("workflows.back")}
          </button>

          <div className="wf-detail__hero">
            <div>
              <h2 style={{ margin: 0 }}>{wf.title}</h2>
              <p className="wf-detail__objective">
                {wf.objective.length > 200 ? wf.objective.slice(0, 200) + "…" : wf.objective}
              </p>
              <div className="wf-detail__hero-tags">
                <Badge status={wf.status} variant={STATUS_VARIANT[wf.status] || "off"} />
                <Badge status={`${done_agents}/${total_agents} agents`} variant="info" />
                <Badge status={`Phase ${wf.current_phase + 1}/${wf.phases.length}`} variant="off" />
                <span className="wf-detail__time" title={new Date(wf.updated_at).toLocaleString()}>
                  {time_ago(wf.updated_at)}
                </span>
              </div>
            </div>
            {(wf.status === "failed" || wf.status === "waiting_user_input") && (
              <ResumeButton workflowId={wf.workflow_id} />
            )}
          </div>

          {wf.phases.map((phase, i) => {
            const def = wf.definition?.phases?.find((d) => d.phase_id === phase.phase_id);
            return (
              <PhaseCard
                key={phase.phase_id}
                phase={phase}
                index={i}
                isCurrent={i === wf.current_phase && wf.status === "running"}
                maxIterations={def?.max_loop_iterations}
                workflowId={wf.workflow_id}
                onChat={(agent_id, label, model, status) =>
                  setChatTarget({ phase_id: phase.phase_id, agent_id, label, model, status, phase_title: phase.title })
                }
              />
            );
          })}
        </div>

        {chatTarget && id && (
          <AgentChatPanel
            workflow_id={id}
            phase_id={chatTarget.phase_id}
            agent_id={chatTarget.agent_id}
            label={chatTarget.label}
            model={chatTarget.model}
            status={chatTarget.status}
            phase_title={chatTarget.phase_title}
            onClose={() => setChatTarget(null)}
          />
        )}
      </div>
    </div>
  );
}

const MODE_LABEL: Record<string, string> = {
  interactive: "Interactive",
  sequential_loop: "Loop",
};

const MODE_ICON: Record<string, string> = {
  interactive: "🔄",
  sequential_loop: "🔁",
};

function PhaseCard({ phase, index, isCurrent, maxIterations, workflowId, onChat }: {
  phase: PhaseState;
  index: number;
  isCurrent: boolean;
  maxIterations?: number;
  workflowId: string;
  onChat: (agent_id: string, label: string, model?: string, status?: string) => void;
}) {
  const t = useT();
  const mode = phase.mode || "parallel";
  const modeLabel = MODE_LABEL[mode];
  const defaultCollapsed = phase.status === "completed" && !isCurrent;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className={`wf-phase ${DESK_CLS[phase.status] || "desk--off"}${isCurrent ? " wf-phase--current" : ""}`}>
      {/* Phase Header — 클릭으로 접기/펼치기 */}
      <div className="wf-phase__header" onClick={() => setCollapsed((c) => !c)} style={{ cursor: "pointer", userSelect: "none" }}>
        <div className="wf-phase__title-group">
          <span className="wf-phase__collapse-icon">{collapsed ? "▸" : "▾"}</span>
          <span className="wf-phase__index">Phase {index + 1}</span>
          <h3 className="wf-phase__title">{phase.title}</h3>
          {modeLabel && (
            <span className="wf-phase__mode-badge">
              {MODE_ICON[mode]} {modeLabel}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge status={phase.status} variant={STATUS_VARIANT[phase.status] || "off"} />
          {phase.pending_user_input && (
            <Badge status={t("workflows.awaiting_input")} variant="warn" />
          )}
          {collapsed && (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
              {phase.agents.length} agents
            </span>
          )}
        </div>
      </div>

      {/* Mode-specific body */}
      {!collapsed && (mode === "interactive" ? (
        <InteractivePhaseBody
          phase={phase}
          workflowId={workflowId}
          maxIterations={maxIterations || 20}
        />
      ) : mode === "sequential_loop" ? (
        <SequentialLoopPhaseBody
          phase={phase}
          maxIterations={maxIterations || 50}
          onChat={onChat}
        />
      ) : (
        <ParallelPhaseBody phase={phase} onChat={onChat} />
      ))}

      {!collapsed && phase.critic && <CriticCard critic={phase.critic} />}
    </section>
  );
}

/** Parallel 모드: 에이전트 그리드 (기존 방식). */
function ParallelPhaseBody({ phase, onChat }: {
  phase: PhaseState;
  onChat: (agent_id: string, label: string, model?: string, status?: string) => void;
}) {
  const completed = phase.agents.filter((a) => a.status === "completed").length;
  const total = phase.agents.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <>
      <div className="wf-progress">
        <div className="wf-progress__bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="stat-grid stat-grid--narrow">
        {phase.agents.map((agent) => (
          <AgentCard key={agent.agent_id} agent={agent} onChat={onChat} />
        ))}
      </div>
    </>
  );
}

/** 에이전트 카드: 결과 복사 + 에러 펼치기. */
function AgentCard({ agent, onChat }: {
  agent: PhaseAgentState;
  onChat: (agent_id: string, label: string, model?: string, status?: string) => void;
}) {
  const t = useT();
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyResult = useCallback(() => {
    const text = agent.result || agent.error || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [agent.result, agent.error]);

  return (
    <div className={`stat-card stat-card--compact ${DESK_CLS[agent.status] || "desk--off"}`}>
      <div className="stat-card__header">
        <Badge status={agent.status} variant={STATUS_VARIANT[agent.status] || "off"} />
        {(agent.result || agent.error) && (
          <button
            className="btn btn--xs wf-agent__copy"
            onClick={copyResult}
            title={copied ? "Copied!" : "Copy result"}
          >
            {copied ? "✓" : "⧉"}
          </button>
        )}
      </div>
      <div className="stat-card__value stat-card__value--md">{agent.label}</div>
      <div className="stat-card__label">{agent.role}{agent.model ? ` · ${agent.model}` : ""}</div>
      {agent.result && (
        <div className="stat-card__extra wf-agent__result">
          {agent.result.length > 120 ? agent.result.slice(0, 120) + "…" : agent.result}
        </div>
      )}
      {agent.error && (
        <div
          className="stat-card__extra wf-agent__error"
          onClick={() => setErrorExpanded((e) => !e)}
          style={{ cursor: agent.error.length > 80 ? "pointer" : undefined }}
        >
          {errorExpanded ? agent.error : (agent.error.length > 80 ? agent.error.slice(0, 80) + "… ▸" : agent.error)}
        </div>
      )}
      <div className="stat-card__actions">
        <button
          className="btn btn--xs"
          onClick={() => onChat(agent.agent_id, agent.label, agent.model, agent.status)}
        >
          💬 {t("workflows.chat")}
        </button>
      </div>
    </div>
  );
}

/** Interactive 모드: 인라인 채팅 버블 UI. */
function InteractivePhaseBody({ phase, workflowId, maxIterations }: {
  phase: PhaseState;
  workflowId: string;
  maxIterations: number;
}) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const agent = phase.agents[0];
  if (!agent) return null;

  const msgKey = ["workflow-messages", workflowId, phase.phase_id, agent.agent_id];

  const { data: messages } = useQuery<PhaseMessage[]>({
    queryKey: msgKey,
    queryFn: () => api.get(
      `/api/workflows/${workflowId}/messages?phase_id=${phase.phase_id}&agent_id=${agent.agent_id}`,
    ),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: (content: string) =>
      api.post(`/api/workflows/${workflowId}/messages`, {
        phase_id: phase.phase_id,
        agent_id: agent.agent_id,
        content,
      }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: msgKey });
    },
    onError: () => toast(t("workflows.send_failed")),
  });

  const iteration = phase.loop_iteration || 0;

  return (
    <div className="wf-interactive">
      <div className="wf-interactive__messages">
        {messages?.map((msg, i) => (
          <MessageBubble
            key={i}
            role={msg.role}
            content={msg.content.slice(0, 2000)}
            at={msg.at}
            showRoleBadge
            alignUserRight
          />
        ))}
        <div ref={endRef} />
      </div>

      {phase.pending_user_input && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim()) sendMut.mutate(input.trim()); }}
          className="wf-interactive__input"
        >
          <input
            className="input"
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("workflows.chat_placeholder")}
            disabled={sendMut.isPending}
          />
          <button className="btn btn--primary btn--sm" type="submit" disabled={sendMut.isPending || !input.trim()}>
            {t("workflows.send")}
          </button>
        </form>
      )}

      <div className="wf-interactive__footer">
        <span className="wf-interactive__turn">
          {t("workflows.turn")} {iteration}/{maxIterations}
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
          {agent.label} · {agent.model || "default"}
        </span>
      </div>
    </div>
  );
}

/** Sequential Loop 모드: 반복 타임라인. */
function SequentialLoopPhaseBody({ phase, maxIterations, onChat }: {
  phase: PhaseState;
  maxIterations: number;
  onChat: (agent_id: string, label: string, model?: string, status?: string) => void;
}) {
  const t = useT();
  const results = phase.loop_results || [];
  const iteration = phase.loop_iteration || 0;
  const pct = maxIterations > 0 ? Math.round((iteration / maxIterations) * 100) : 0;
  const agent = phase.agents[0];

  return (
    <>
      <div className="wf-progress">
        <div className="wf-progress__bar" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>

      <div className="wf-loop-timeline">
        {results.map((result, i) => {
          const isUserInput = result.startsWith("User:");
          const isAskUser = result.includes("[ASK_USER]");
          return (
            <div
              key={i}
              className={`wf-loop-timeline__item${i === iteration - 1 && phase.status === "running" ? " wf-loop-timeline__item--active" : ""}`}
            >
              <span className="wf-loop-timeline__marker" title={isAskUser ? "Ask user for input" : isUserInput ? "User input" : "Completed"}>
                {isAskUser ? "❓" : isUserInput ? "👤" : "✅"} #{i + 1}
              </span>
              <span className="wf-loop-timeline__text">
                {result.slice(0, 120)}{result.length > 120 ? "…" : ""}
              </span>
            </div>
          );
        })}

        {iteration < maxIterations && phase.status === "running" && !phase.pending_user_input && (
          <div className="wf-loop-timeline__item wf-loop-timeline__item--active">
            <span className="wf-loop-timeline__marker" title="Currently running">🔄 #{iteration + 1}</span>
            <span className="wf-loop-timeline__text">{t("workflows.loading")}...</span>
          </div>
        )}

        {iteration + 1 < maxIterations && (
          <div className="wf-loop-timeline__item wf-loop-timeline__item--remaining">
            <span className="wf-loop-timeline__marker" title="Remaining iterations">⏳</span>
            <span className="wf-loop-timeline__text">
              #{iteration + 2}–{maxIterations} {t("workflows.remaining")}
            </span>
          </div>
        )}
      </div>

      <div className="wf-loop-timeline__footer">
        <span>{iteration}/{maxIterations} {t("workflows.iterations")}</span>
        {agent && (
          <button
            className="btn btn--xs"
            onClick={() => onChat(agent.agent_id, agent.label, agent.model, agent.status)}
          >
            💬 {t("workflows.chat")}
          </button>
        )}
      </div>
    </>
  );
}

function ResumeButton({ workflowId }: { workflowId: string }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => api.post(`/api/workflows/${workflowId}/resume`, {}),
    onSuccess: () => {
      toast(t("workflows.resumed"));
      qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
    onError: () => toast(t("workflows.resume_failed")),
  });
  return (
    <button className="btn btn--primary btn--sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
      {mut.isPending ? t("workflows.loading") : t("workflows.resume")}
    </button>
  );
}

function CriticCard({ critic }: { critic: PhaseCriticState }) {
  return (
    <div className={`wf-critic ${critic.approved === true ? "desk--ok" : critic.approved === false ? "desk--err" : "desk--off"}`}>
      <div className="wf-critic__header">
        <span className="wf-critic__label">Critic</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge status={critic.status} variant={STATUS_VARIANT[critic.status] || "off"} />
          {critic.model && <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>{critic.model}</span>}
        </div>
      </div>
      {critic.review && (
        <div className="wf-critic__review">
          <Badge
            status={critic.approved ? "Approved" : "Rejected"}
            variant={critic.approved ? "ok" : "err"}
          />
          <span className="wf-critic__review-text">
            {critic.review.slice(0, 200)}
          </span>
        </div>
      )}
    </div>
  );
}

function AgentChatPanel({ workflow_id, phase_id, agent_id, label, model, status, phase_title, onClose }: {
  workflow_id: string;
  phase_id: string;
  agent_id: string;
  label: string;
  model?: string;
  status?: string;
  phase_title?: string;
  onClose: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const msg_query_key = ["workflow-messages", workflow_id, phase_id, agent_id];

  const { data: messages } = useQuery<PhaseMessage[]>({
    queryKey: msg_query_key,
    queryFn: () => api.get(`/api/workflows/${workflow_id}/messages?phase_id=${phase_id}&agent_id=${agent_id}`),
    refetchInterval: 3_000,
  });

  const { pending: pending_approvals, resolve: resolve_approval } = useApprovals({
    related_query_keys: [msg_query_key],
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending_approvals.length]);

  const sendMut = useMutation({
    mutationFn: (content: string) =>
      api.post(`/api/workflows/${workflow_id}/messages`, { phase_id, agent_id, content }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: msg_query_key });
    },
    onError: () => toast(t("workflows.send_failed")),
  });

  return (
    <div className="wf-chat">
      <div className="wf-chat__header">
        <div>
          <div className="wf-chat__name">
            {label}
            {model && <span className="wf-chat__model">{model}</span>}
            {status && <Badge status={status} variant={STATUS_VARIANT[status] || "off"} />}
            {pending_approvals.length > 0 && (
              <Badge status={`🔐 ${pending_approvals.length}`} variant="warn" />
            )}
          </div>
          {phase_title && <div className="wf-chat__id">{phase_title}</div>}
        </div>
        <button className="btn btn--xs" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="wf-chat__messages">
        {messages?.map((msg, i) => (
          <MessageBubble
            key={i}
            role={msg.role}
            content={msg.content.slice(0, 2000)}
            at={msg.at}
            showRoleBadge
            alignUserRight={false}
          />
        ))}

        {pending_approvals.map((ap) => (
          <ApprovalBanner
            key={ap.request_id}
            approval={ap}
            onResolve={(text) => void resolve_approval(ap.request_id, text)}
          />
        ))}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (input.trim()) sendMut.mutate(input.trim()); }}
        className="wf-chat__input"
      >
        <input
          className="input"
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("workflows.chat_placeholder")}
          disabled={sendMut.isPending}
        />
        <button className="btn btn--primary btn--sm" type="submit" disabled={sendMut.isPending || !input.trim()}>
          {t("workflows.send")}
        </button>
      </form>
    </div>
  );
}
