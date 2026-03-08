import { useState, useRef, useEffect } from "react";
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
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);

  const { data: wf, isLoading } = useQuery<PhaseLoopState>({
    queryKey: ["workflow", id],
    queryFn: () => api.get(`/api/workflow/runs/${id}`),
    refetchInterval: 10_000, staleTime: 3_000,
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
          <button className="btn btn--ghost btn--sm mb-3" onClick={() => navigate("/workflows")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
            {t("workflows.back")}
          </button>

          <div className="wf-detail__hero">
            <div className="wf-detail__hero-content">
              <div className="wf-detail__hero-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div>
                <h2 className="wf-detail__title">{wf.title}</h2>
                <p className="wf-detail__objective">
                  {!objectiveExpanded && wf.objective.length > 200
                    ? wf.objective.slice(0, 200) + "… "
                    : wf.objective + " "}
                  {wf.objective.length > 200 && (
                    <button className="btn-link text-xs" onClick={() => setObjectiveExpanded((v) => !v)}>
                      {objectiveExpanded ? t("workflows.objective_show_less") : t("workflows.objective_show_more")}
                    </button>
                  )}
                </p>
              </div>
            </div>
            <div className="wf-detail__hero-meta">
              <div className="wf-detail__hero-tags">
                <Badge status={wf.status} variant={STATUS_VARIANT[wf.status] || "off"} />
                <Badge status={`${done_agents}/${total_agents} agents`} variant="info" />
                <Badge status={`Phase ${wf.current_phase + 1}/${wf.phases.length}`} variant="off" />
                <span className="wf-detail__time" title={new Date(wf.updated_at).toLocaleString()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {time_ago(wf.updated_at)}
                </span>
              </div>
              {(wf.status === "failed" || wf.status === "waiting_user_input") && (
                <ResumeButton workflowId={wf.workflow_id} />
              )}
            </div>
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

const MODE_LABEL_KEY: Record<string, string> = {
  interactive: "workflows.mode_interactive",
  sequential_loop: "workflows.mode_loop",
};

function ModeIcon({ mode }: { mode: string }) {
  if (mode === "interactive") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-6.2-8.56"/><polyline points="21 3 21 12 12 12"/></svg>
  );
  if (mode === "sequential_loop") return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
  );
  return null;
}

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
  const modeLabel = MODE_LABEL_KEY[mode] ? t(MODE_LABEL_KEY[mode]) : undefined;
  const defaultCollapsed = phase.status === "completed" && !isCurrent;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className={`wf-phase ${DESK_CLS[phase.status] || "desk--off"}${isCurrent ? " wf-phase--current" : ""}`}>
      {/* Phase Header — 클릭으로 접기/펼치기 */}
      <div className="wf-phase__header" role="button" tabIndex={0} onClick={() => setCollapsed((c) => !c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed((c) => !c); } }}>
        <div className="wf-phase__title-group">
          <span className="wf-phase__collapse-icon">
            <svg className={`wf-chevron${collapsed ? " wf-chevron--closed" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
          <span className="wf-phase__index-num">{index + 1}</span>
          <h3 className="wf-phase__title">{phase.title}</h3>
          {modeLabel && (
            <span className="wf-phase__mode-badge">
              <ModeIcon mode={mode} /> {modeLabel}
            </span>
          )}
        </div>
        <div className="wf-phase__header-right">
          <Badge status={phase.status} variant={STATUS_VARIANT[phase.status] || "off"} />
          {phase.pending_user_input && (
            <Badge status={t("workflows.awaiting_input")} variant="warn" />
          )}
          {collapsed && (
            <span className="text-xs text-muted">
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
      <div className="wf-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${completed}/${total} agents`}>
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
  const { toast } = useToast();
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyResult = () => {
    const text = agent.result || agent.error || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => toast(t("workflows.copy_failed"), "err"));
  };

  return (
    <div className={`stat-card stat-card--compact ${DESK_CLS[agent.status] || "desk--off"}`}>
      <div className="stat-card__header">
        <Badge status={agent.status} variant={STATUS_VARIANT[agent.status] || "off"} />
        {(agent.result || agent.error) && (
          <button
            className="btn btn--xs wf-agent__copy"
            onClick={copyResult}
            title={copied ? t("workflows.copied") : t("workflows.copy_result")}
            aria-label={copied ? t("workflows.copied") : t("workflows.copy_result")}
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            )}
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
          className={`stat-card__extra wf-agent__error${agent.error.length > 80 ? " wf-agent__error--expandable" : ""}`}
          role={agent.error.length > 80 ? "button" : undefined}
          tabIndex={agent.error.length > 80 ? 0 : undefined}
          onClick={() => setErrorExpanded((e) => !e)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setErrorExpanded((v) => !v); } }}
        >
          {errorExpanded ? agent.error : (agent.error.length > 80 ? agent.error.slice(0, 80) + "… ▸" : agent.error)}
        </div>
      )}
      <div className="stat-card__actions">
        <button
          className="btn btn--xs btn--ghost"
          onClick={() => onChat(agent.agent_id, agent.label, agent.model, agent.status)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          {t("workflows.chat")}
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

  const msgKey = ["workflow-messages", workflowId, phase.phase_id, agent?.agent_id ?? ""];

  const { data: messages } = useQuery<PhaseMessage[]>({
    queryKey: msgKey,
    queryFn: () => api.get(
      `/api/workflow/runs/${workflowId}/messages?phase_id=${phase.phase_id}&agent_id=${agent!.agent_id}`,
    ),
    enabled: !!agent,
    refetchInterval: 10_000, staleTime: 3_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: (content: string) =>
      api.post(`/api/workflow/runs/${workflowId}/messages`, {
        phase_id: phase.phase_id,
        agent_id: agent!.agent_id,
        content,
      }),
    onSuccess: () => {
      setInput("");
      void qc.invalidateQueries({ queryKey: msgKey });
    },
    onError: () => toast(t("workflows.send_failed"), "err"),
  });

  if (!agent) return null;

  const iteration = phase.loop_iteration || 0;

  return (
    <div className="wf-interactive">
      <div className="wf-interactive__messages">
        {messages?.map((msg, i) => (
          <MessageBubble
            key={`${msg.role}-${msg.at}-${i}`}
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
            className="input flex-fill"
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
        <span className="text-xs text-muted">
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
      <div className="wf-progress" role="progressbar" aria-valuenow={iteration} aria-valuemin={0} aria-valuemax={maxIterations} aria-label={`${iteration}/${maxIterations} iterations`}>
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
                {isAskUser ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                ) : isUserInput ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                )}
                <span>#{i + 1}</span>
              </span>
              <span className="wf-loop-timeline__text">
                {result.slice(0, 120)}{result.length > 120 ? "…" : ""}
              </span>
            </div>
          );
        })}

        {iteration < maxIterations && phase.status === "running" && !phase.pending_user_input && (
          <div className="wf-loop-timeline__item wf-loop-timeline__item--active">
            <span className="wf-loop-timeline__marker" title="Currently running">
              <svg className="wf-loop-timeline__spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 11-6.2-8.56"/></svg>
              <span>#{iteration + 1}</span>
            </span>
            <span className="wf-loop-timeline__text">{t("workflows.loading")}...</span>
          </div>
        )}

        {iteration + 1 < maxIterations && (
          <div className="wf-loop-timeline__item wf-loop-timeline__item--remaining">
            <span className="wf-loop-timeline__marker" title="Remaining iterations">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </span>
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
            className="btn btn--xs btn--ghost"
            onClick={() => onChat(agent.agent_id, agent.label, agent.model, agent.status)}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            {t("workflows.chat")}
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
    mutationFn: () => api.post(`/api/workflow/runs/${workflowId}/resume`, {}),
    onSuccess: () => {
      toast(t("workflows.resumed"), "ok");
      void qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
    },
    onError: () => toast(t("workflows.resume_failed"), "err"),
  });
  return (
    <button className="btn btn--ok btn--sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
      {mut.isPending ? (
        <span className="btn__spinner" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      )}
      {mut.isPending ? t("workflows.loading") : t("workflows.resume")}
    </button>
  );
}

function CriticCard({ critic }: { critic: PhaseCriticState }) {
  return (
    <div className={`wf-critic ${critic.approved === true ? "desk--ok" : critic.approved === false ? "desk--err" : "desk--off"}`}>
      <div className="wf-critic__header">
        <span className="wf-critic__label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Critic
        </span>
        <div className="wf-critic__header-right">
          <Badge status={critic.status} variant={STATUS_VARIANT[critic.status] || "off"} />
          {critic.model && <span className="text-xs text-muted">{critic.model}</span>}
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
    queryFn: () => api.get(`/api/workflow/runs/${workflow_id}/messages?phase_id=${phase_id}&agent_id=${agent_id}`),
    refetchInterval: 10_000, staleTime: 3_000,
  });

  const { pending: pending_approvals, resolve: resolve_approval } = useApprovals({
    related_query_keys: [msg_query_key],
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending_approvals.length]);

  const sendMut = useMutation({
    mutationFn: (content: string) =>
      api.post(`/api/workflow/runs/${workflow_id}/messages`, { phase_id, agent_id, content }),
    onSuccess: () => {
      setInput("");
      void qc.invalidateQueries({ queryKey: msg_query_key });
    },
    onError: () => toast(t("workflows.send_failed"), "err"),
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
        <button className="btn btn--xs btn--ghost" onClick={onClose} aria-label={t("workflows.close")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="wf-chat__messages">
        {messages?.map((msg, i) => (
          <MessageBubble
            key={`${msg.role}-${msg.at}-${i}`}
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
          className="input flex-fill"
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
