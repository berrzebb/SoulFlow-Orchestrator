import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { Modal, FormModal } from "../components/modal";
import { ToggleSwitch } from "../components/toggle-switch";
import { useToast } from "../components/toast";
import { useTestMutation } from "../hooks/use-test-mutation";
import { useT } from "../i18n";
import { PROVIDER_COLORS } from "../utils/constants";

interface ChannelInstance {
  provider: string;
  instance_id: string;
  label: string;
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  last_error?: string;
  token_configured: boolean;
  default_target: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type ModalMode = { kind: "add" } | { kind: "edit"; instance: ChannelInstance };

function ProviderIcon({ provider }: { provider: string }) {
  const color = PROVIDER_COLORS[provider] ?? "var(--accent)";
  const label = provider.charAt(0).toUpperCase();
  return (
    <span className="provider-icon" style={{ background: color }}>
      {label}
    </span>
  );
}


interface ConfigField {
  path: string;
  value: unknown;
  type: string;
}

interface ConfigResponse {
  raw: Record<string, unknown>;
  sections: Array<{ id: string; fields: ConfigField[] }>;
}

function GlobalSettingsSection() {
  const t = useT();
  const qc = useQueryClient();

  const { data } = useQuery<ConfigResponse>({
    queryKey: ["config"],
    queryFn: () => api.get("/api/config"),
  });

  const sections = Array.isArray(data?.sections) ? data.sections : [];

  const get_value = (path: string): boolean => {
    for (const sec of sections) {
      const field = sec.fields?.find((f: ConfigField) => f.path === path);
      if (field) return Boolean(field.value);
    }
    return false;
  };

  const toggle = async (path: string, current: boolean) => {
    await api.put("/api/config/values", { path, value: !current });
    void qc.invalidateQueries({ queryKey: ["config"] });
  };

  const streaming = get_value("channel.streaming.enabled");
  const auto_reply = get_value("channel.autoReply");

  const settings = [
    {
      key: "channel.streaming.enabled",
      label: t("channels.stream_progress"),
      desc: t("channels.stream_progress_desc"),
      value: streaming,
    },
    {
      key: "channel.autoReply",
      label: t("channels.auto_reply"),
      desc: t("channels.auto_reply_desc"),
      value: auto_reply,
    },
  ];

  return (
    <section className="panel">
      <h2 style={{ margin: "0 0 12px" }}>{t("channels.global_settings")}</h2>
      <div className="stat-grid stat-grid--wide">
        {settings.map((s) => (
          <div key={s.key} className="settings-row">
            <div>
              <div className="settings-row__label">{s.label}</div>
              <div className="settings-row__desc">{s.desc}</div>
            </div>
            <ToggleSwitch checked={s.value} onChange={() => void toggle(s.key, s.value)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ChannelsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelInstance | null>(null);

  const { data: instances, isLoading } = useQuery<ChannelInstance[]>({
    queryKey: ["channel-instances"],
    queryFn: () => api.get("/api/channel-instances"),
    refetchInterval: 10_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/channel-instances/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("channels.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["channel-instances"] }); },
    onError: (err) => toast(t("channels.remove_failed", { error: err.message }), "err"),
  });

  const toggle_enabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/api/channel-instances/${encodeURIComponent(id)}`, { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channel-instances"] }),
    onError: (err) => toast(t("channels.save_failed", { error: err.message }), "err"),
  });

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("channels.title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          {t("channels.add")}
        </button>
      </div>

      <GlobalSettingsSection />

      {isLoading ? (
        <div className="stat-grid stat-grid--wide" style={{ marginTop: 16 }}>
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : !instances?.length ? (
        <p className="empty">{t("channels.no_instances")}</p>
      ) : (
        <div className="stat-grid stat-grid--wide" style={{ marginTop: 16 }}>
          {instances.map((inst) => (
            <InstanceCard
              key={inst.instance_id}
              instance={inst}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
              onToggle={(enabled) => toggle_enabled.mutate({ id: inst.instance_id, enabled })}
            />
          ))}
        </div>
      )}

      {modal && (
        <InstanceModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["channel-instances"] });
          }}
        />
      )}

      <Modal
        open={!!deleteTarget}
        title={t("channels.remove_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.instance_id);
          setDeleteTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("channels.remove_confirm", { label: deleteTarget?.label || deleteTarget?.instance_id || "" })}
        </p>
      </Modal>
    </div>
  );
}

function InstanceCard({ instance, onEdit, onRemove, onToggle }: {
  instance: ChannelInstance;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();

  const { testing, testResult, test } = useTestMutation({
    url: `/api/channel-instances/${encodeURIComponent(instance.instance_id)}/test`,
    onOk: (r) => `${instance.label}: ${r.detail || t("channels.connected")}`,
    onFail: (r) => `${instance.label}: ${r.error || ""}`,
    onError: () => t("channels.test_failed"),
  });

  const status_cls = instance.running ? "ok" : "off";

  return (
    <div className={`stat-card desk--${status_cls}`} style={{ opacity: instance.enabled ? 1 : 0.7 }}>
      <div className="stat-card__header">
        <ProviderIcon provider={instance.provider} />
        <ToggleSwitch checked={instance.enabled} onChange={onToggle} />
      </div>
      <div className="stat-card__value stat-card__value--md">
        {instance.label || instance.instance_id}
      </div>
      <div className="stat-card__label">{instance.instance_id}</div>
      <div className="stat-card__extra">
        {instance.running && <Badge status={t("channels.running")} variant="ok" />}
        {" "}
        <span className={instance.token_configured ? "text-ok" : "text-err"}>
          {instance.token_configured ? t("channels.token_configured") : t("channels.no_token")}
        </span>
        {instance.default_target && (
          <span className="text-xs text-muted"> · {instance.default_target}</span>
        )}
      </div>
      {instance.last_error && (
        <div className="text-xs text-err">{instance.last_error}</div>
      )}
      {testResult && (
        <div className="stat-card__tags">
          <Badge status={testResult.ok ? t("channels.pass") : t("channels.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span className="text-muted">{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}
      <div className="stat-card__actions">
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        <button className="btn btn--xs btn--ok" onClick={() => test.mutate()} disabled={testing || !instance.token_configured}>
          {testing ? t("common.testing") : t("common.test")}
        </button>
        <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
      </div>
    </div>
  );
}

const PROVIDER_OPTIONS = [
  { value: "slack", label: "Slack" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
];

function InstanceModal({ mode, onClose, onSaved }: {
  mode: ModalMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.instance : null;
  const t = useT();

  const [provider, setProvider] = useState(initial?.provider || "slack");
  const [instanceId, setInstanceId] = useState(initial?.instance_id || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [token, setToken] = useState("");
  const [defaultTarget, setDefaultTarget] = useState(
    String(initial?.settings?.default_channel || initial?.settings?.default_chat_id || ""),
  );
  const [apiBase, setApiBase] = useState(String(initial?.settings?.api_base || ""));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const auto_id = !isEdit && !instanceId;

  function build_settings(): Record<string, unknown> {
    const s: Record<string, unknown> = {};
    if (provider === "telegram") {
      if (defaultTarget) s.default_chat_id = defaultTarget;
      if (apiBase) s.api_base = apiBase;
    } else {
      if (defaultTarget) s.default_channel = defaultTarget;
      if (provider === "discord" && apiBase) s.api_base = apiBase;
    }
    return s;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = isEdit ? initial!.instance_id : (instanceId || provider);
      if (isEdit) {
        await api.put(`/api/channel-instances/${encodeURIComponent(id)}`, {
          label, enabled, settings: build_settings(),
          ...(token ? { token } : {}),
        });
      } else {
        await api.post("/api/channel-instances", {
          instance_id: id, provider, label: label || id, enabled, settings: build_settings(),
          ...(token ? { token } : {}),
        });
      }
      toast(isEdit ? t("channels.updated") : t("channels.added"), "ok");
      onSaved();
    } catch (err) {
      toast(t("channels.save_failed", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      title={isEdit ? t("channels.edit_title") : t("channels.add_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? t("common.save") : t("common.add")}
      saving={saving}
    >
      <div className="form-group">
        <label className="form-label">{t("channels.provider")}</label>
        {isEdit ? (
          <input className="form-input" value={provider} disabled />
        ) : (
          <select className="form-input" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">{t("channels.instance_id")}</label>
        <input
          className="form-input"
          value={auto_id ? provider : instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          disabled={isEdit}
          placeholder={provider}
        />
        {!isEdit && <span className="form-hint">{t("channels.instance_id_hint")}</span>}
      </div>

      <div className="form-group">
        <label className="form-label">{t("channels.label")}</label>
        <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("channels.label_placeholder")} />
      </div>

      <div className="form-group form-group--row">
        <label className="form-label" style={{ margin: 0 }}>{t("common.enabled")}</label>
        <ToggleSwitch checked={enabled} onChange={setEnabled} />
      </div>

      <div className="form-group">
        <label className="form-label">{t("channels.bot_token")}</label>
        <input
          className="form-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={isEdit ? t("channels.bot_token_placeholder_edit") : t("channels.bot_token_placeholder_new")}
          autoComplete="off"
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          {provider === "telegram" ? t("channels.default_chat_id") : t("channels.default_target")}
        </label>
        <input
          className="form-input"
          value={defaultTarget}
          onChange={(e) => setDefaultTarget(e.target.value)}
          placeholder={provider === "telegram" ? "-1001234567890" : "#general"}
        />
      </div>

      {(provider === "discord" || provider === "telegram") && (
        <div className="form-group">
          <label className="form-label">{t("channels.api_base")}</label>
          <input
            className="form-input"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder={provider === "telegram" ? "https://api.telegram.org" : "https://discord.com/api/v10"}
          />
        </div>
      )}
    </FormModal>
  );
}
