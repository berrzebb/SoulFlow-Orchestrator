import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { MessageBubble } from "../../components/message-bubble";

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
              </div>
            </div>
          </div>

          {wf.phases.map((phase, i) => (
            <PhaseCard
              key={phase.phase_id}
              phase={phase}
              index={i}
              isCurrent={i === wf.current_phase && wf.status === "running"}
              onChat={(agent_id, label, model, status) =>
                setChatTarget({ phase_id: phase.phase_id, agent_id, label, model, status, phase_title: phase.title })
              }
            />
          ))}
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

function PhaseCard({ phase, index, isCurrent, onChat }: {
  phase: PhaseState;
  index: number;
  isCurrent: boolean;
  onChat: (agent_id: string, label: string, model?: string, status?: string) => void;
}) {
  const t = useT();
  const completed = phase.agents.filter((a) => a.status === "completed").length;
  const total = phase.agents.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <section className={`wf-phase ${DESK_CLS[phase.status] || "desk--off"}${isCurrent ? " wf-phase--current" : ""}`}>
      <div className="wf-phase__header">
        <div className="wf-phase__title-group">
          <span className="wf-phase__index">Phase {index + 1}</span>
          <h3 className="wf-phase__title">{phase.title}</h3>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Badge status={phase.status} variant={STATUS_VARIANT[phase.status] || "off"} />
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
            {completed}/{total}
            {phase.critic && ` + 1 ${t("workflows.critic")}`}
          </span>
        </div>
      </div>

      <div className="wf-progress">
        <div className="wf-progress__bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="stat-grid stat-grid--narrow">
        {phase.agents.map((agent) => (
          <div key={agent.agent_id} className={`stat-card stat-card--compact ${DESK_CLS[agent.status] || "desk--off"}`}>
            <div className="stat-card__header">
              <Badge status={agent.status} variant={STATUS_VARIANT[agent.status] || "off"} />
            </div>
            <div className="stat-card__value stat-card__value--md">{agent.label}</div>
            <div className="stat-card__label">{agent.role}{agent.model ? ` · ${agent.model}` : ""}</div>
            {agent.result && (
              <div className="stat-card__extra wf-agent__result">
                {agent.result.slice(0, 120)}…
              </div>
            )}
            {agent.error && (
              <div className="stat-card__extra wf-agent__error">
                {agent.error.slice(0, 80)}
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
        ))}
      </div>

      {phase.critic && <CriticCard critic={phase.critic} />}
    </section>
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

  const { data: messages } = useQuery<PhaseMessage[]>({
    queryKey: ["workflow-messages", workflow_id, phase_id, agent_id],
    queryFn: () => api.get(`/api/workflows/${workflow_id}/messages?phase_id=${phase_id}&agent_id=${agent_id}`),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: (content: string) =>
      api.post(`/api/workflows/${workflow_id}/messages`, { phase_id, agent_id, content }),
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey: ["workflow-messages", workflow_id, phase_id, agent_id] });
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
