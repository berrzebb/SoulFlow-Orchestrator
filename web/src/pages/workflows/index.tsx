/** 워크플로우 통합 목록 — Templates 카탈로그 + Running 탭. */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";

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
  const [selectedTpl, setSelectedTpl] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [quickObjective, setQuickObjective] = useState("");

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

  const quickRunMut = useMutation({
    mutationFn: (objective: string) =>
      api.post<{ ok: boolean; workflow_id?: string; error?: string }>("/api/workflows", { objective, title: objective.slice(0, 60) }),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) {
        setQuickObjective("");
        qc.invalidateQueries({ queryKey: ["workflows"] });
        toast(t("workflows.created"));
        navigate(`/workflows/${data.workflow_id}`);
      } else {
        toast(data.error || "Failed");
      }
    },
    onError: () => toast(t("workflows.create_failed")),
  });

  const runFromTplMut = useMutation({
    mutationFn: (body: { template_name: string; title: string; objective: string }) =>
      api.post<{ ok: boolean; workflow_id?: string; error?: string }>("/api/workflows", body),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) {
        setSelectedTpl(null);
        qc.invalidateQueries({ queryKey: ["workflows"] });
        toast(t("workflows.created"));
        navigate(`/workflows/${data.workflow_id}`);
      } else {
        toast(data.error || "Failed");
      }
    },
    onError: () => toast(t("workflows.create_failed")),
  });

  const handleQuickRun = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickObjective.trim()) return;
    quickRunMut.mutate(quickObjective.trim());
  };

  /** 상태 우선순위: 실행 중 > 대기 > 실패 > 완료 > 취소. */
  const STATUS_ORDER: Record<string, number> = {
    running: 0, waiting_user_input: 1, reviewing: 2, failed: 3, pending: 4, completed: 5, cancelled: 6,
  };
  const sortedWorkflows = (workflows || []).slice().sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
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

      {/* Quick Run — objective만 입력하여 즉시 실행 */}
      <form className="quick-run-bar" onSubmit={handleQuickRun} style={{ display: "flex", gap: 8, marginBottom: "var(--sp-3)" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={quickObjective}
          onChange={(e) => setQuickObjective(e.target.value)}
          placeholder={t("workflows.quick_run_placeholder")}
        />
        <button className="btn btn--accent" type="submit" disabled={!quickObjective.trim() || quickRunMut.isPending}>
          {t("workflows.quick_run")}
        </button>
      </form>

      {/* 탭 */}
      <div className="builder-tabs" style={{ marginBottom: "var(--sp-3)" }}>
        <button className={`builder-tab${tab === "templates" ? " active" : ""}`} onClick={() => setTab("templates")}>
          {t("workflows.templates")} ({tplCount})
        </button>
        <button className={`builder-tab${tab === "running" ? " active" : ""}`} onClick={() => setTab("running")}>
          {t("workflows.running_tab")} ({runningCount})
        </button>
      </div>

      {/* Templates 카탈로그 */}
      {tab === "templates" && (
        <>
          {tplLoading ? (
            <div className="stat-grid stat-grid--wide">
              <div className="skeleton skeleton-card" style={{ height: 140 }} />
              <div className="skeleton skeleton-card" style={{ height: 140 }} />
            </div>
          ) : !templates?.length ? (
            <div className="empty-state">
              <p className="empty-state__text">{t("workflows.no_templates")}</p>
              <div className="empty-state__actions">
                <button className="btn btn--sm btn--accent" onClick={() => navigate("/workflows/new")}>
                  + {t("workflows.new_workflow")}
                </button>
                <button className="btn btn--sm" onClick={() => setShowImport(true)}>
                  {t("workflows.import")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="stat-grid stat-grid--wide">
                {templates.map((tpl) => {
                  const agent_count = tpl.phases.reduce((n, p) => n + p.agents.length, 0);
                  const selected = selectedTpl === tpl.title;
                  return (
                    <div
                      key={tpl.title}
                      className={`stat-card desk--info tpl-catalog__card${selected ? " tpl-catalog__card--selected" : ""}`}
                      onClick={() => setSelectedTpl(selected ? null : tpl.title)}
                    >
                      <div className="stat-card__header">
                        <Badge status={`${tpl.phases.length} phases`} variant="info" />
                        <Badge status={`${agent_count} agents`} variant="off" />
                      </div>
                      <div className="stat-card__value stat-card__value--md">{tpl.title}</div>
                      {tpl.objective && (
                        <div className="stat-card__extra">
                          {tpl.objective.length > 80 ? tpl.objective.slice(0, 80) + "…" : tpl.objective}
                        </div>
                      )}
                      <div className="tpl-catalog__phases">
                        {tpl.phases.map((p, i) => (
                          <span key={p.phase_id} className="tpl-catalog__phase-chip">
                            {i > 0 && <span className="tpl-catalog__arrow">→</span>}
                            {p.title}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedTpl && templates.find((t) => t.title === selectedTpl) && (
                <TemplateDetailPanel
                  template={templates.find((t) => t.title === selectedTpl)!}
                  onClose={() => setSelectedTpl(null)}
                  onRun={(body) => {
                    runFromTplMut.mutate(body);
                  }}
                  onEdit={() => navigate(`/workflows/edit/${encodeURIComponent(slugify(selectedTpl))}`)}
                  onDelete={() => setDeleteTarget(slugify(selectedTpl))}
                  running={runFromTplMut.isPending}
                />
              )}
            </>
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
          {wfLoading ? (
            <div className="stat-grid stat-grid--wide">
              <div className="skeleton skeleton-card" style={{ height: 180 }} />
              <div className="skeleton skeleton-card" style={{ height: 180 }} />
            </div>
          ) : !sortedWorkflows.length ? (
            <div className="empty-state">
              <p className="empty-state__text">{t("workflows.empty")}</p>
              <p className="empty-state__hint">{t("workflows.empty_hint") || "Use Quick Run above or create a workflow from a template."}</p>
            </div>
          ) : (
            <div className="stat-grid stat-grid--wide">
              {sortedWorkflows.map((wf) => {
                const pct = progress_percent(wf);
                const agent_count = wf.phases.reduce((n, p) => n + p.agents.length, 0);
                const critic_count = wf.phases.filter((p) => p.critic).length;
                return (
                  <div key={wf.workflow_id} className={`stat-card ${DESK_CLS[wf.status] || "desk--off"}`}>
                    <div className="stat-card__header">
                      <Badge status={wf.status} variant={STATUS_VARIANT[wf.status] || "off"} />
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }} title={new Date(wf.updated_at).toLocaleString()}>
                        {time_ago(wf.updated_at)}
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
                    </div>
                    <div className="wf-progress" title={`${pct}%`}>
                      <div
                        className={`wf-progress__bar${wf.status === "failed" ? " wf-progress__bar--err" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                      <span className="wf-progress__label">{pct}%</span>
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

// ── Template Detail Panel (카탈로그 상세) ──

function TemplateDetailPanel({ template, onClose, onRun, onEdit, onDelete, running }: {
  template: WorkflowTemplate;
  onClose: () => void;
  onRun: (body: { template_name: string; title: string; objective: string }) => void;
  onEdit: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const t = useT();
  const [title, setTitle] = useState(template.title);
  const [objective, setObjective] = useState(template.objective);

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    onRun({ template_name: template.title, title: title || template.title, objective });
  };

  const agent_count = template.phases.reduce((n, p) => n + p.agents.length, 0);
  const critic_count = template.phases.filter((p) => p.critic).length;

  return (
    <div className="tpl-detail">
      <div className="tpl-detail__header">
        <h3 style={{ margin: 0 }}>{template.title}</h3>
        <button className="tpl-detail__close" onClick={onClose} aria-label="close">✕</button>
      </div>

      <p className="tpl-detail__objective">{template.objective}</p>

      <div className="tpl-detail__meta">
        <Badge status={`${template.phases.length} phases`} variant="info" />
        <Badge status={`${agent_count} agents`} variant="off" />
        {critic_count > 0 && <Badge status={`${critic_count} critics`} variant="warn" />}
      </div>

      {/* Phase 흐름 시각화 */}
      <div className="tpl-detail__flow">
        {template.phases.map((p, i) => (
          <div key={p.phase_id} className="tpl-detail__phase-step">
            {i > 0 && <span className="tpl-detail__flow-arrow">→</span>}
            <div className="tpl-detail__phase-box">
              <div className="tpl-detail__phase-title">{p.title}</div>
              <div className="tpl-detail__phase-info">
                {p.agents.length} {t("workflows.agents").toLowerCase()}
              </div>
              {p.critic && (
                <div className="tpl-detail__phase-critic">{t("workflows.critic")}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 실행 폼 */}
      <form className="tpl-detail__form" onSubmit={handleRun}>
        <div className="tpl-detail__form-row">
          <label className="label">{t("workflows.title_label")}</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="tpl-detail__form-row">
          <label className="label">{t("workflows.objective_label")}</label>
          <textarea
            className="input"
            rows={2}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={t("workflows.objective_placeholder")}
          />
        </div>
        <div className="tpl-detail__actions">
          <button type="button" className="btn btn--sm" onClick={onEdit}>
            {t("workflows.edit_template")}
          </button>
          <button type="button" className="btn btn--sm btn--danger" onClick={onDelete}>
            {t("workflows.delete_template")}
          </button>
          <div style={{ flex: 1 }} />
          <button type="submit" className="btn btn--accent" disabled={running}>
            {running ? t("workflows.creating") : `▶ ${t("workflows.run_template")}`}
          </button>
        </div>
      </form>
    </div>
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
