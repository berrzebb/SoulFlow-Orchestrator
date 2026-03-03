import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { useToast } from "../components/toast";
import { useT } from "../i18n";

interface ProviderInstance {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  priority: number;
  supported_modes: string[];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  available: boolean;
  circuit_state: string;
  capabilities: Record<string, boolean> | null;
  token_configured: boolean;
}

type ModalMode = { kind: "add" } | { kind: "edit"; instance: ProviderInstance };

const TYPE_LABELS: Record<string, string> = {
  claude_cli: "Claude CLI",
  codex_cli: "Codex CLI",
  claude_sdk: "Claude SDK",
  codex_appserver: "Codex Appserver",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI Compatible",
};

export default function ProvidersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);

  const { data: instances, isLoading } = useQuery<ProviderInstance[]>({
    queryKey: ["agent-providers"],
    queryFn: () => api.get("/api/agent-providers"),
    refetchInterval: 10_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/agent-providers/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("providers.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["agent-providers"] }); },
    onError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
  });

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("providers.title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          {t("providers.add")}
        </button>
      </div>

      {isLoading ? (
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : !instances?.length ? (
        <p className="empty">{t("providers.no_instances")}</p>
      ) : (
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {instances.map((inst) => (
            <ProviderCard
              key={inst.instance_id}
              instance={inst}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => {
                if (confirm(t("providers.remove_confirm", { label: inst.label || inst.instance_id }))) remove.mutate(inst.instance_id);
              }}
            />
          ))}
        </div>
      )}

      {modal && (
        <ProviderModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["agent-providers"] });
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({ instance, onEdit, onRemove }: {
  instance: ProviderInstance;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string; error?: string } | null>(null);
  const { toast } = useToast();
  const t = useT();

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail?: string; error?: string }>(
      `/api/agent-providers/${encodeURIComponent(instance.instance_id)}/test`,
    ),
    onMutate: () => { setTesting(true); setTestResult(null); },
    onSuccess: (r) => {
      setTestResult(r);
      toast(r.ok ? `${instance.label}: ${t("providers.available")}` : `${instance.label}: ${r.error}`, r.ok ? "ok" : "err");
    },
    onError: (err) => {
      setTestResult({ ok: false, error: err.message });
      toast(t("providers.test_failed"), "err");
    },
    onSettled: () => setTesting(false),
  });

  const status_cls = instance.available ? "ok" : instance.enabled ? "warn" : "off";

  return (
    <div className={`stat-card desk--${status_cls}`}>
      <div className="stat-card__header" style={{ flexWrap: "wrap", gap: 4 }}>
        <Badge status={TYPE_LABELS[instance.provider_type] || instance.provider_type} variant="info" />
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Badge status={instance.enabled ? t("providers.on") : t("providers.off")} variant={instance.enabled ? "ok" : "off"} />
          {instance.available && <Badge status={t("providers.available")} variant="ok" />}
          {instance.circuit_state !== "closed" && (
            <Badge status={instance.circuit_state} variant={instance.circuit_state === "open" ? "err" : "warn"} />
          )}
        </span>
      </div>
      <div className="stat-card__value" style={{ fontSize: "var(--fs-md)" }}>
        {instance.label || instance.instance_id}
      </div>
      <div className="stat-card__label">{instance.instance_id}</div>
      <div className="stat-card__extra">
        {instance.token_configured
          ? <span style={{ color: "var(--ok)" }}>{t("providers.token_configured")}</span>
          : <span style={{ color: "var(--err)" }}>{t("providers.no_token")}</span>
        }
        {" · "}
        <span style={{ color: "var(--muted)" }}>{t("providers.priority")}: {instance.priority}</span>
      </div>
      {instance.supported_modes.length > 0 && (
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {instance.supported_modes.map((m) => <Badge key={m} status={m} variant="info" />)}
        </div>
      )}
      {testResult && (
        <div style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
          <Badge status={testResult.ok ? t("providers.pass") : t("providers.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span style={{ marginLeft: 4 }}>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}
      <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        <button className="btn btn--xs btn--ok" onClick={() => test.mutate()} disabled={testing || !instance.token_configured}>
          {testing ? t("common.testing") : t("common.test")}
        </button>
        <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
      </div>
    </div>
  );
}

const MODE_OPTIONS = ["once", "agent", "task"] as const;

function ProviderModal({ mode, onClose, onSaved }: {
  mode: ModalMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.instance : null;
  const t = useT();

  const { data: types = [] } = useQuery<string[]>({
    queryKey: ["agent-provider-types"],
    queryFn: () => api.get("/api/agent-providers/types"),
  });

  const [providerType, setProviderType] = useState(initial?.provider_type || "claude_sdk");
  const [instanceId, setInstanceId] = useState(initial?.instance_id || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 10);
  const [token, setToken] = useState("");
  const [selectedModes, setSelectedModes] = useState<Set<string>>(
    new Set(initial?.supported_modes ?? ["once", "agent", "task"]),
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const toggle_mode = (m: string) => {
    const next = new Set(selectedModes);
    if (next.has(m)) next.delete(m); else next.add(m);
    setSelectedModes(next);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = isEdit ? initial!.instance_id : (instanceId || providerType);
      const body = {
        provider_type: providerType,
        label: label || id,
        enabled,
        priority,
        supported_modes: [...selectedModes],
        settings: {},
        ...(token ? { token } : {}),
      };
      if (isEdit) {
        await api.put(`/api/agent-providers/${encodeURIComponent(id)}`, body);
      } else {
        await api.post("/api/agent-providers", { instance_id: id, ...body });
      }
      toast(isEdit ? t("providers.updated") : t("providers.added"), "ok");
      onSaved();
    } catch (err) {
      toast(t("providers.save_failed", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSaving(false);
    }
  }

  const typeOptions = types.length > 0 ? types : Object.keys(TYPE_LABELS);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{isEdit ? t("providers.edit_title") : t("providers.add_title")}</h3>
          <button className="modal__close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="form-group">
              <label className="form-label">{t("providers.provider_type")}</label>
              {isEdit ? (
                <input className="form-input" value={TYPE_LABELS[providerType] || providerType} disabled />
              ) : (
                <select className="form-input" value={providerType} onChange={(e) => setProviderType(e.target.value)}>
                  {typeOptions.map((tp) => <option key={tp} value={tp}>{TYPE_LABELS[tp] || tp}</option>)}
                </select>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">{t("providers.instance_id")}</label>
              <input
                className="form-input"
                value={instanceId || (isEdit ? initial!.instance_id : "")}
                onChange={(e) => setInstanceId(e.target.value)}
                disabled={isEdit}
                placeholder={providerType}
              />
              {!isEdit && <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
                {t("providers.instance_id_hint")}
              </span>}
            </div>

            <div className="form-group">
              <label className="form-label">{t("providers.label")}</label>
              <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("providers.label_placeholder")} />
            </div>

            <div className="form-group">
              <label className="form-label">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                {" "}{t("common.enabled")}
              </label>
            </div>

            <div className="form-group">
              <label className="form-label">{t("providers.priority")}</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
                {t("providers.priority_hint")}
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">{t("providers.api_token")}</label>
              <input
                className="form-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={isEdit ? t("providers.token_placeholder_edit") : t("providers.token_placeholder_new")}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t("providers.modes")}</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MODE_OPTIONS.map((m) => (
                  <label key={m} style={{ fontSize: "var(--fs-sm)", display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="checkbox" checked={selectedModes.has(m)} onChange={() => toggle_mode(m)} />
                    {m}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="modal__footer">
            <button type="button" className="btn btn--sm" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn--sm btn--accent" disabled={saving}>
              {saving ? t("common.saving") : isEdit ? t("common.save") : t("common.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
