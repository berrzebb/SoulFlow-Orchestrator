import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";

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

export default function WorkflowTemplatesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const navigate = useNavigate();
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<WorkflowTemplate[]>({
    queryKey: ["workflow-templates"],
    queryFn: () => api.get("/api/workflow-templates"),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.del(`/api/workflow-templates/${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast(t("workflows.template_deleted"));
      qc.invalidateQueries({ queryKey: ["workflow-templates"] });
      setDeleteTarget(null);
    },
  });

  return (
    <div className="page">
      <div className="section-header">
        <div>
          <h2>{t("workflows.templates")}</h2>
          <p style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", margin: 0 }}>
            {t("workflows.templates_desc")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn--sm" onClick={() => navigate("/workflows")}>
            ← {t("workflows.back")}
          </button>
          <button className="btn btn--sm" onClick={() => setShowImport(true)}>
            {t("workflows.import")}
          </button>
          <button className="btn btn--sm btn--accent" onClick={() => navigate("/workflows/templates/new")}>
            + {t("workflows.new_template")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="stat-grid stat-grid--wide">
          <div className="skeleton skeleton-card" style={{ height: 160 }} />
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
                  {critic_count > 0 && (
                    <Badge status={`${critic_count} critics`} variant="warn" />
                  )}
                </div>
                <div className="stat-card__actions">
                  <button className="btn btn--sm" onClick={() => navigate(`/workflows/templates/${encodeURIComponent(slug)}`)}>
                    {t("workflows.edit_template")}
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
    </div>
  );
}

function ImportModal({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [yamlText, setYamlText] = useState("");

  const importMut = useMutation({
    mutationFn: (yaml: string) =>
      api.post<{ ok: boolean; name?: string; error?: string }>("/api/workflow-templates/import", { yaml }),
    onSuccess: (data) => {
      if (data.ok) { setYamlText(""); onImported(); }
      else toast(data.error || t("workflows.import_error"));
    },
    onError: () => toast(t("workflows.import_error")),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setYamlText(text);
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

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9가-힣\-_\s]/g, "").replace(/[\s]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}
