/** 워크플로우 통합 목록 — Templates 카탈로그 + Running 탭. */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { DeleteConfirmModal, useModalEffects } from "../../components/modal";
import { SkeletonGrid } from "../../components/skeleton-grid";
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
  slug: string;
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

/** 상태 우선순위: 실행 중 > 대기 > 실패 > 완료 > 취소. */
const STATUS_ORDER: Record<string, number> = {
  running: 0, waiting_user_input: 1, reviewing: 2, failed: 3, pending: 4, completed: 5, cancelled: 6,
};

function progress_percent(wf: PhaseLoopState): number {
  const total = wf.phases.length;
  if (total === 0) return 0;
  return Math.round((wf.phases.filter((p) => p.status === "completed").length / total) * 100);
}

// ── Page ──

export default function WorkflowsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const navigate = useNavigate();
  const templateListRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<"templates" | "running">("templates");
  const [selectedTpl, setSelectedTpl] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [quickObjective, setQuickObjective] = useState("");

  const { data: workflows, isLoading: wfLoading } = useQuery<PhaseLoopState[]>({
    queryKey: ["workflows"],
    queryFn: () => api.get("/api/workflow/runs"),
    refetchInterval: 10_000,
    staleTime: 3_000,
  });

  const { data: templates, isLoading: tplLoading } = useQuery<WorkflowTemplate[]>({
    queryKey: ["workflow-templates"],
    staleTime: 30_000,
    queryFn: async () => {
      const raw = await api.get<WorkflowTemplate[]>("/api/workflow/templates");
      // slug 없는 레거시 응답 방어: title 기반 slug 생성
      return raw.map((tpl, i) => ({
        ...tpl,
        slug: tpl.slug || tpl.title?.toLowerCase().replace(/[^a-z0-9가-힣\-_]/g, "-").replace(/-+/g, "-") || `tpl-${i}`,
      }));
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.del(`/api/workflow/runs/${id}`),
    onSuccess: () => { toast(t("workflows.cancelled"), "ok"); void qc.invalidateQueries({ queryKey: ["workflows"] }); setCancelTarget(null); },
    onError: () => toast(t("workflows.cancel_failed"), "err"),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.del(`/api/workflow/templates/${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast(t("workflows.template_deleted"), "ok");
      void qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      setDeleteTarget(null);
      // 삭제 후 리스트의 첫 번째 항목으로 포커스 이동 (접근성)
      setTimeout(() => {
        const firstTemplate = templateListRef.current?.querySelector('[role="button"]');
        (firstTemplate as HTMLElement)?.focus();
      }, 0);
    },
  });

  const quickRunMut = useMutation({
    mutationFn: (objective: string) =>
      api.post<{ ok: boolean; workflow_id?: string; error?: string }>("/api/workflow/runs", { objective, title: objective.slice(0, 60) }),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) {
        setQuickObjective("");
        void qc.invalidateQueries({ queryKey: ["workflows"] });
        toast(t("workflows.created"), "ok");
        navigate(`/workflows/${data.workflow_id}`);
      } else {
        toast(data.error || "Failed", "err");
      }
    },
    onError: () => toast(t("workflows.create_failed"), "err"),
  });

  const runFromTplMut = useMutation({
    mutationFn: (body: { template_name: string; title: string; objective: string }) =>
      api.post<{ ok: boolean; workflow_id?: string; error?: string }>("/api/workflow/runs", body),
    onSuccess: (data) => {
      if (data.ok && data.workflow_id) {
        setSelectedTpl(null);
        void qc.invalidateQueries({ queryKey: ["workflows"] });
        toast(t("workflows.created"), "ok");
        navigate(`/workflows/${data.workflow_id}`);
      } else {
        toast(data.error || "Failed", "err");
      }
    },
    onError: () => toast(t("workflows.create_failed"), "err"),
  });

  const handleQuickRun = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickObjective.trim()) return;
    quickRunMut.mutate(quickObjective.trim());
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
      {/* 히어로 헤더 */}
      <div className="wf-hero">
        <div className="wf-hero__content">
          <h1 className="wf-hero__title">{t("workflows.title")}</h1>
          <p className="wf-hero__desc">{t("workflows.description")}</p>
          {/* Quick Run */}
          <form className="wf-hero__quick-run" onSubmit={handleQuickRun}>
            <div className="wf-hero__input-wrap">
              <svg className="wf-hero__input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <input
                autoFocus
                className="wf-hero__input"
                value={quickObjective}
                onChange={(e) => setQuickObjective(e.target.value)}
                placeholder={t("workflows.quick_run_placeholder")}
              />
              <button className="wf-hero__run-btn" type="submit" disabled={!quickObjective.trim() || quickRunMut.isPending}>
                {quickRunMut.isPending ? <span className="btn__spinner" /> : null}
                {t("workflows.quick_run")}
              </button>
            </div>
          </form>
        </div>
        <div className="wf-hero__actions">
          {tab === "templates" && (
            <button className="btn btn--sm btn--ghost" onClick={() => setShowImport(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t("workflows.import")}
            </button>
          )}
          <button className="btn btn--sm btn--accent" onClick={() => navigate("/workflows/new")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("workflows.new_workflow")}
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="builder-tabs mb-3" role="tablist">
        <button role="tab" aria-selected={tab === "templates"} className={`builder-tab${tab === "templates" ? " active" : ""}`} onClick={() => setTab("templates")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          {t("workflows.templates")} ({tplCount})
        </button>
        <button role="tab" aria-selected={tab === "running"} className={`builder-tab${tab === "running" ? " active" : ""}`} onClick={() => setTab("running")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          {t("workflows.running_tab")} ({runningCount})
        </button>
      </div>

      {/* Templates 카탈로그 */}
      {tab === "templates" && (
        <>
          {tplLoading ? (
            <SkeletonGrid count={4} cardStyle={{ height: 140 }} />
          ) : !templates?.length ? (
            <EmptyState title={t("workflows.no_templates")} actions={<>
              <button className="btn btn--sm btn--accent" onClick={() => navigate("/workflows/new")}>
                + {t("workflows.new_workflow")}
              </button>
              <button className="btn btn--sm" onClick={() => setShowImport(true)}>
                {t("workflows.import")}
              </button>
            </>} />
          ) : (
            <>
              <div className="stat-grid stat-grid--wide" ref={templateListRef}>
                {templates.map((tpl) => {
                  const agent_count = tpl.phases.reduce((n, p) => n + p.agents.length, 0);
                  const selected = selectedTpl === tpl.slug;
                  return (
                    <div
                      key={tpl.slug}
                      role="button"
                      tabIndex={0}
                      className={`stat-card desk--info tpl-catalog__card${selected ? " tpl-catalog__card--selected" : ""}`}
                      onClick={() => setSelectedTpl(selected ? null : tpl.slug)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedTpl(selected ? null : tpl.slug); } }}
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

              {(() => {
                const tplMatch = selectedTpl ? templates.find((t) => t.slug === selectedTpl) : undefined;
                return tplMatch ? (
                <TemplateDetailPanel
                  template={tplMatch}
                  initialObjective={quickObjective.trim() || undefined}
                  onClose={() => setSelectedTpl(null)}
                  onRun={(body) => {
                    runFromTplMut.mutate(body);
                  }}
                  onEdit={() => navigate(`/workflows/edit/${encodeURIComponent(selectedTpl!)}`)}
                  onDelete={() => setDeleteTarget(selectedTpl)}
                  running={runFromTplMut.isPending}
                />
                ) : null;
              })()}
            </>
          )}

          <ImportModal
            open={showImport}
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false);
              void qc.invalidateQueries({ queryKey: ["workflow-templates"] });
              toast(t("workflows.import_success"), "ok");
            }}
          />

          <DeleteConfirmModal
            open={!!deleteTarget}
            title={t("workflows.delete_template")}
            message={t("workflows.confirm_delete")}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget)}
            confirmLabel={t("workflows.delete_template")}
          />
        </>
      )}

      {/* Cancel Workflow Confirm */}
      <DeleteConfirmModal
        open={!!cancelTarget}
        title={t("workflows.cancel_confirm_title")}
        message={t("workflows.cancel_confirm_desc")}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => cancelTarget && cancelMut.mutate(cancelTarget)}
        confirmLabel={t("workflows.cancel_confirm_ok")}
      />

      {/* Running 탭 */}
      {tab === "running" && (
        <>
          {wfLoading ? (
            <SkeletonGrid count={4} cardStyle={{ height: 180 }} />
          ) : !sortedWorkflows.length ? (
            <EmptyState title={t("workflows.empty")} description={t("workflows.empty_hint")} />
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
                      <span className="text-xs text-muted" title={new Date(wf.updated_at).toLocaleString()}>
                        {time_ago(wf.updated_at)}
                        {wf.status === "running" && wf.created_at && (
                          <> · {time_ago(wf.created_at)} {t("workflows.elapsed")}</>
                        )}
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
                    <div className="wf-progress" title={`${pct}%`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("workflows.progress")}>
                      <div
                        className={`wf-progress__bar${wf.status === "failed" ? " wf-progress__bar--err" : wf.status === "running" ? " wf-progress__bar--running" : ""}`}
                        style={{ width: `${Math.max(pct, 3)}%` }}
                      />
                      <span className="wf-progress__label">{pct}%</span>
                    </div>
                    <div className="stat-card__actions">
                      <button className="btn btn--sm btn--ghost" onClick={() => navigate(`/workflows/${wf.workflow_id}`)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        {t("workflows.view_detail")}
                      </button>
                      {(wf.status === "running" || wf.status === "waiting_user_input") && (
                        <button
                          className="btn btn--sm btn--danger"
                          onClick={() => setCancelTarget(wf.workflow_id)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
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

function TemplateDetailPanel({ template, initialObjective, onClose, onRun, onEdit, onDelete, running }: {
  template: WorkflowTemplate;
  initialObjective?: string;
  onClose: () => void;
  onRun: (body: { template_name: string; title: string; objective: string }) => void;
  onEdit: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const t = useT();
  const [currentSlug, setCurrentSlug] = useState(template.slug);
  const [title, setTitle] = useState(template.title);
  const [objective, setObjective] = useState(initialObjective ?? template.objective);
  const [hasChanges, setHasChanges] = useState(false);

  // template.slug 변경 시 로컬 편집 상태 리셋 — 렌더 중 setState (cascading 렌더 방지에 React가 최적화)
  if (currentSlug !== template.slug) {
    setCurrentSlug(template.slug);
    setTitle(template.title);
    setObjective(initialObjective ?? template.objective);
    setHasChanges(false);
  }

  const baseObjective = initialObjective ?? template.objective;

  const handleChangeTitle = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    setHasChanges(e.target.value !== template.title || objective !== baseObjective);
  };

  const handleChangeObjective = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setObjective(e.target.value);
    setHasChanges(title !== template.title || e.target.value !== baseObjective);
  };

  const handleClose = () => {
    if (hasChanges && !window.confirm(t("workflows.unsaved_changes_confirm") || "변경사항이 저장되지 않습니다. 계속하시겠습니까?")) {
      return;
    }
    onClose();
  };

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    onRun({ template_name: template.slug, title: title || template.title, objective });
  };

  const agent_count = template.phases.reduce((n, p) => n + p.agents.length, 0);
  const critic_count = template.phases.filter((p) => p.critic).length;

  return (
    <div className="tpl-detail">
      <div className="tpl-detail__header">
        <h3 className="mt-0 mb-0">{template.title}</h3>
        <button className="btn btn--xs btn--ghost tpl-detail__close" onClick={handleClose} aria-label="close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
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
            {i > 0 && (
              <span className="tpl-detail__flow-arrow">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </span>
            )}
            <div className="tpl-detail__phase-box">
              <span className="tpl-detail__phase-num">{i + 1}</span>
              <div>
                <div className="tpl-detail__phase-title">{p.title}</div>
                <div className="tpl-detail__phase-info">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {p.agents.length} {t("workflows.agents").toLowerCase()}
                  {p.critic && (
                    <span className="tpl-detail__phase-critic">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      {t("workflows.critic")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 실행 폼 */}
      <form className="tpl-detail__form" onSubmit={handleRun}>
        <div className="tpl-detail__form-row">
          <label className="label">{t("workflows.title_label")}</label>
          <input className="input" value={title} onChange={handleChangeTitle} />
        </div>
        <div className="tpl-detail__form-row">
          <label className="label">{t("workflows.objective_label")}</label>
          <textarea
            className="input"
            rows={2}
            value={objective}
            onChange={handleChangeObjective}
            placeholder={t("workflows.objective_placeholder")}
          />
        </div>
        <div className="tpl-detail__actions">
          <button type="button" className="btn btn--sm btn--ghost" onClick={onEdit}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            {t("workflows.edit_template")}
          </button>
          <button type="button" className="btn btn--sm btn--danger" onClick={onDelete}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            {t("workflows.delete_template")}
          </button>
          <div className="flex-fill" />
          <button type="submit" className="btn btn--ok" disabled={running}>
            {running ? (
              <span className="btn__spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            )}
            {running ? t("workflows.creating") : t("workflows.run_template")}
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
  useModalEffects(open, onClose);
  const { toast } = useToast();
  const modalRef = useRef<HTMLDivElement>(null);
  const [yamlText, setYamlText] = useState("");

  useEffect(() => { if (open) modalRef.current?.focus(); }, [open]);

  const importMut = useMutation({
    mutationFn: (yaml_str: string) =>
      api.post<{ ok: boolean; name?: string; error?: string }>("/api/workflow/templates", { yaml: yaml_str }),
    onSuccess: (data) => {
      if (data.ok) { setYamlText(""); onImported(); }
      else toast(data.error || t("workflows.import_error"), "err");
    },
    onError: () => toast(t("workflows.import_error"), "err"),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setYamlText(await file.text());
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal modal--wide" ref={modalRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{t("workflows.import_yaml")}</h3>
          <button className="modal__close btn btn--xs btn--ghost" onClick={onClose} aria-label="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal__body">
          <label className="label">{t("workflows.upload_file")}</label>
          <input type="file" accept=".yaml,.yml,.json" onChange={handleFile} className="mb-2" />
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
          <button className="btn btn--sm btn--ghost" onClick={onClose}>{t("workflows.close")}</button>
          <button
            className="btn btn--sm btn--accent"
            disabled={!yamlText.trim() || importMut.isPending}
            onClick={() => importMut.mutate(yamlText)}
          >
            {importMut.isPending ? (
              <span className="btn__spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            )}
            {t("workflows.import")}
          </button>
        </div>
      </div>
    </div>
  );
}
