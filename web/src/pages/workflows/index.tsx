import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { FormModal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";

interface PhaseLoopState {
  workflow_id: string;
  title: string;
  objective: string;
  status: string;
  current_phase: number;
  phases: Array<{
    phase_id: string;
    title: string;
    status: string;
    agents: Array<{ agent_id: string; label: string; status: string }>;
    critic?: { status: string; approved?: boolean };
  }>;
  created_at: string;
  updated_at: string;
}

interface WorkflowTemplate {
  title: string;
  objective: string;
  phases: Array<{
    phase_id: string;
    title: string;
    agents: Array<{ agent_id: string; role: string; label: string }>;
    critic?: { system_prompt: string };
  }>;
}

const STATUS_VARIANT: Record<string, "ok" | "warn" | "err" | "off"> = {
  running: "ok",
  completed: "ok",
  failed: "err",
  cancelled: "off",
  waiting_user_input: "warn",
  pending: "off",
  reviewing: "warn",
};

const DESK_CLS: Record<string, string> = {
  running: "desk--ok",
  completed: "desk--ok",
  failed: "desk--err",
  cancelled: "desk--off",
  waiting_user_input: "desk--warn",
  pending: "desk--off",
  reviewing: "desk--warn",
};

function progress_percent(wf: PhaseLoopState): number {
  const total = wf.phases.length;
  if (total === 0) return 0;
  const done = wf.phases.filter((p) => p.status === "completed").length;
  return Math.round((done / total) * 100);
}

export default function WorkflowsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  const { data: workflows, isLoading } = useQuery<PhaseLoopState[]>({
    queryKey: ["workflows"],
    queryFn: () => api.get("/api/workflows"),
    refetchInterval: 5_000,
  });

  const { data: templates } = useQuery<WorkflowTemplate[]>({
    queryKey: ["workflow-templates"],
    queryFn: () => api.get("/api/workflow-templates"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.del(`/api/workflows/${id}`),
    onSuccess: () => { toast(t("workflows.cancelled")); qc.invalidateQueries({ queryKey: ["workflows"] }); },
  });

  return (
    <div className="page">
      <div className="section-header">
        <div>
          <h2>{t("workflows.title")}</h2>
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", margin: 0 }}>
            {t("workflows.description")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--sm" onClick={() => navigate("/workflows/templates")}>
            {t("workflows.templates")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={() => setShowCreate(true)}>
            + {t("workflows.create")}
          </button>
        </div>
      </div>

      <CreateWorkflowModal
        open={showCreate}
        templates={templates || []}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          setShowCreate(false);
          qc.invalidateQueries({ queryKey: ["workflows"] });
          toast(t("workflows.created"));
          navigate(`/workflows/${id}`);
        }}
      />

      {isLoading ? (
        <div className="stat-grid stat-grid--wide">
          <div className="skeleton skeleton-card" style={{ height: 180 }} />
          <div className="skeleton skeleton-card" style={{ height: 180 }} />
          <div className="skeleton skeleton-card" style={{ height: 180 }} />
        </div>
      ) : !workflows?.length ? (
        <p className="empty">{t("workflows.empty")}</p>
      ) : (
        <div className="stat-grid stat-grid--wide">
          {workflows.map((wf) => {
            const pct = progress_percent(wf);
            const agent_count = wf.phases.reduce((n, p) => n + p.agents.length, 0);
            const critic_count = wf.phases.filter((p) => p.critic).length;
            return (
              <div key={wf.workflow_id} className={`stat-card ${DESK_CLS[wf.status] || "desk--off"}`}>
                <div className="stat-card__header">
                  <Badge status={wf.status} variant={STATUS_VARIANT[wf.status] || "off"} />
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
                    {new Date(wf.updated_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="stat-card__value stat-card__value--md">{wf.title}</div>
                <div className="stat-card__extra">
                  {wf.objective.length > 100 ? wf.objective.slice(0, 100) + "…" : wf.objective}
                </div>
                <div className="stat-card__tags">
                  <Badge status={`Phase ${wf.current_phase + 1}/${wf.phases.length}`} variant="info" />
                  <Badge status={`${agent_count} agents`} variant="off" />
                  {critic_count > 0 && <Badge status={`${critic_count} critics`} variant="off" />}
                  <Badge status={`${pct}%`} variant={pct === 100 ? "ok" : "warn"} />
                </div>
                <div className="wf-progress">
                  <div
                    className={`wf-progress__bar${wf.status === "failed" ? " wf-progress__bar--err" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="stat-card__actions">
                  <button className="btn btn--sm" onClick={() => navigate(`/workflows/${wf.workflow_id}`)}>
                    {t("workflows.view_detail")}
                  </button>
                  {(wf.status === "running" || wf.status === "waiting_user_input") && (
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => cancelMut.mutate(wf.workflow_id)}
                      disabled={cancelMut.isPending}
                    >
                      {t("workflows.cancel")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateWorkflowModal({ open, templates, onClose, onCreated }: {
  open: boolean;
  templates: WorkflowTemplate[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean; workflow_id?: string; error?: string }>("/api/workflows", body),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) onCreated(data.workflow_id);
      else toast(data.error || "Failed");
    },
    onError: () => toast(t("workflows.create_failed")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) { toast(t("workflows.select_template")); return; }
    createMut.mutate({ template_name: selectedTemplate, title: title || selectedTemplate, objective });
  };

  return (
    <FormModal
      open={open}
      title={t("workflows.create_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t("workflows.create")}
      saving={createMut.isPending}
    >
      <label className="label">{t("workflows.template")}</label>
      <select
        className="input"
        value={selectedTemplate}
        onChange={(e) => {
          setSelectedTemplate(e.target.value);
          const tmpl = templates.find((tp) => tp.title === e.target.value);
          if (tmpl) { setTitle(tmpl.title); setObjective(tmpl.objective); }
        }}
      >
        <option value="">{t("workflows.select_template")}</option>
        {templates.map((tmpl) => (
          <option key={tmpl.title} value={tmpl.title}>
            {tmpl.title} ({tmpl.phases.length} phases)
          </option>
        ))}
      </select>

      <label className="label">{t("workflows.title_label")}</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label className="label">{t("workflows.objective_label")}</label>
      <textarea
        className="input"
        rows={3}
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder={t("workflows.objective_placeholder")}
      />
    </FormModal>
  );
}
