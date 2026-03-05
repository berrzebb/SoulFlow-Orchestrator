/** 워크플로우 통합 목록 — Templates 탭 + Running 탭. */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { FormModal, Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";

// ── Types ──

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
  variables?: Record<string, string>;
  phases: Array<{
    phase_id: string;
    title: string;
    agents: Array<{ agent_id: string; role: string; label: string; backend: string }>;
    critic?: { system_prompt: string; gate: boolean };
  }>;
}

// ── Helpers ──

const STATUS_VARIANT: Record<string, "ok" | "warn" | "err" | "off"> = {
  running: "ok", completed: "ok", failed: "err", cancelled: "off",
  waiting_user_input: "warn", pending: "off", reviewing: "warn",
};

const DESK_CLS: Record<string, string> = {
  running: "desk--ok", completed: "desk--ok", failed: "desk--err", cancelled: "desk--off",
  waiting_user_input: "desk--warn", pending: "desk--off", reviewing: "desk--warn",
};

function progress_percent(wf: PhaseLoopState): number {
  const total = wf.phases.length;
  if (total === 0) return 0;
  return Math.round((wf.phases.filter((p) => p.status === "completed").length / total) * 100);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9가-힣\-_\s]/g, "").replace(/[\s]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

// ── Page ──

export default function WorkflowsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"templates" | "running">("templates");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: workflows, isLoading: wfLoading } = useQuery<PhaseLoopState[]>({
    queryKey: ["workflows"],
    queryFn: () => api.get("/api/workflows"),
    refetchInterval: 5_000,
  });

  const { data: templates, isLoading: tplLoading } = useQuery<WorkflowTemplate[]>({
    queryKey: ["workflow-templates"],
    queryFn: () => api.get("/api/workflow-templates"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.del(`/api/workflows/${id}`),
    onSuccess: () => { toast(t("workflows.cancelled")); qc.invalidateQueries({ queryKey: ["workflows"] }); },
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.del(`/api/workflow-templates/${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast(t("workflows.template_deleted"));
      qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      setDeleteTarget(null);
    },
  });

  const runningCount = workflows?.length ?? 0;
  const tplCount = templates?.length ?? 0;

  return (
    <div className="page">
      {/* 헤더 */}
      <div className="section-header">
        <div>
          <h2>{t("workflows.title")}</h2>
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", margin: 0 }}>
            {t("workflows.description")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {tab === "templates" && (
            <button className="btn btn--sm" onClick={() => setShowImport(true)}>
              {t("workflows.import")}
            </button>
          )}
          <button className="btn btn--sm btn--accent" onClick={() => navigate("/workflows/new")}>
            + {t("workflows.new_workflow")}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="builder-tabs" style={{ marginBottom: "var(--sp-3)" }}>
        <button className={`builder-tab${tab === "templates" ? " active" : ""}`} onClick={() => setTab("templates")}>
          {t("workflows.templates")} ({tplCount})
        </button>
        <button className={`builder-tab${tab === "running" ? " active" : ""}`} onClick={() => setTab("running")}>
          {t("workflows.running_tab")} ({runningCount})
        </button>
      </div>

      {/* Templates 탭 */}
      {tab === "templates" && (
        <>
          {tplLoading ? (
            <div className="stat-grid stat-grid--wide">
              <div className="skeleton skeleton-card" style={{ height: 160 }} />
              <div className="skeleton skeleton-card" style={{ height: 160 }} />
            </div>
          ) : !templates?.length ? (
            <p className="empty">{t("workflows.no_templates")}</p>
          ) : (
            <div className="stat-grid stat-grid--wide">
              {templates.map((tpl) => {
                const agent_count = tpl.phases.reduce((n, p) => n + p.agents.length, 0);
                const critic_count = tpl.phases.filter((p) => p.critic).length;
                const slug = slugify(tpl.title);
                return (
                  <div key={tpl.title} className="stat-card desk--info">
                    <div className="stat-card__header">
                      <Badge status={`${tpl.phases.length} phases`} variant="info" />
                      <Badge status={`${agent_count} agents`} variant="off" />
                    </div>
                    <div className="stat-card__value stat-card__value--md">{tpl.title}</div>
                    {tpl.objective && (
                      <div className="stat-card__extra">
                        {tpl.objective.length > 100 ? tpl.objective.slice(0, 100) + "…" : tpl.objective}
                      </div>
                    )}
                    <div className="stat-card__tags">
                      {tpl.phases.map((p) => (
                        <Badge
                          key={p.phase_id}
                          status={p.title + (p.critic ? " + critic" : "")}
                          variant={p.critic ? "warn" : "off"}
                        />
                      ))}
                      {critic_count > 0 && <Badge status={`${critic_count} critics`} variant="warn" />}
                    </div>
                    <div className="stat-card__actions">
                      <button className="btn btn--sm" onClick={() => navigate(`/workflows/edit/${encodeURIComponent(slug)}`)}>
                        {t("workflows.edit_template")}
                      </button>
                      <button className="btn btn--sm" onClick={() => setShowCreate(true)}>
                        {t("workflows.run_template")}
                      </button>
                      <button className="btn btn--sm btn--danger" onClick={() => setDeleteTarget(slug)}>
                        {t("workflows.delete_template")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <ImportModal
            open={showImport}
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false);
              qc.invalidateQueries({ queryKey: ["workflow-templates"] });
              toast(t("workflows.import_success"));
            }}
          />

          <Modal
            open={!!deleteTarget}
            title={t("workflows.delete_template")}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget)}
            confirmLabel={t("workflows.delete_template")}
            danger
          >
            <p>{t("workflows.confirm_delete")}</p>
          </Modal>
        </>
      )}

      {/* Running 탭 */}
      {tab === "running" && (
        <>
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

          {wfLoading ? (
            <div className="stat-grid stat-grid--wide">
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
        </>
      )}
    </div>
  );
}

// ── Create Workflow Modal ──

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

// ── Import Modal ──

function ImportModal({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [yamlText, setYamlText] = useState("");

  const importMut = useMutation({
    mutationFn: (yaml_str: string) =>
      api.post<{ ok: boolean; name?: string; error?: string }>("/api/workflow-templates/import", { yaml: yaml_str }),
    onSuccess: (data) => {
      if (data.ok) { setYamlText(""); onImported(); }
      else toast(data.error || t("workflows.import_error"));
    },
    onError: () => toast(t("workflows.import_error")),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setYamlText(await file.text());
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{t("workflows.import_yaml")}</h3>
          <button className="modal__close" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal__body">
          <label className="label">{t("workflows.upload_file")}</label>
          <input type="file" accept=".yaml,.yml,.json" onChange={handleFile} style={{ marginBottom: 12 }} />
          <label className="label">YAML</label>
          <textarea
            className="input code-textarea"
            rows={16}
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            placeholder={t("workflows.paste_yaml")}
          />
        </div>
        <div className="modal__footer">
          <button className="btn btn--sm" onClick={onClose}>{t("workflows.close")}</button>
          <button
            className="btn btn--sm btn--accent"
            disabled={!yamlText.trim() || importMut.isPending}
            onClick={() => importMut.mutate(yamlText)}
          >
            {t("workflows.import")}
          </button>
        </div>
      </div>
    </div>
  );
}
