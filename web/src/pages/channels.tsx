import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { useToast } from "../components/toast";
import { useT } from "../i18n";

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

const PROVIDER_COLORS: Record<string, string> = {
  slack: "#36C5F0",
  discord: "#5865F2",
  telegram: "#2AABEE",
};

function ProviderIcon({ provider }: { provider: string }) {
  const color = PROVIDER_COLORS[provider] ?? "var(--accent)";
  const label = provider.charAt(0).toUpperCase();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 32, height: 32, borderRadius: 8, background: color,
      color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center",
        width: 40, height: 22, borderRadius: 11, border: "none", cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--ok)" : "var(--line)",
        transition: "background 0.2s", flexShrink: 0, padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: "absolute", left: checked ? 20 : 2, width: 18, height: 18,
        borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </button>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
        {settings.map((s) => (
          <div key={s.key} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, padding: "10px 14px", background: "var(--panel-elevated)",
            borderRadius: 8, border: "1px solid var(--line)",
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.desc}</div>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 16 }}>
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : !instances?.length ? (
        <p className="empty">{t("channels.no_instances")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 16 }}>
          {instances.map((inst) => (
            <InstanceCard
              key={inst.instance_id}
              instance={inst}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => {
                if (confirm(t("channels.remove_confirm", { label: inst.label || inst.instance_id }))) remove.mutate(inst.instance_id);
              }}
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
    </div>
  );
}

function InstanceCard({ instance, onEdit, onRemove, onToggle }: {
  instance: ChannelInstance;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail?: string; error?: string } | null>(null);
  const { toast } = useToast();
  const t = useT();

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail?: string; error?: string }>(
      `/api/channel-instances/${encodeURIComponent(instance.instance_id)}/test`,
    ),
    onMutate: () => { setTesting(true); setTestResult(null); },
    onSuccess: (r) => {
      setTestResult(r);
      toast(r.ok ? `${instance.label}: ${t("channels.connected")}` : `${instance.label}: ${r.error}`, r.ok ? "ok" : "err");
    },
    onError: (err) => {
      setTestResult({ ok: false, error: err.message });
      toast(t("channels.test_failed"), "err");
    },
    onSettled: () => setTesting(false),
  });

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10,
      padding: "14px 16px", background: "var(--panel)",
      borderRadius: 10, border: `1px solid ${instance.running ? "var(--ok)" : instance.enabled ? "var(--line)" : "var(--line)"}`,
      opacity: instance.enabled ? 1 : 0.7,
    }}>
      {/* 헤더: 프로바이더 아이콘 + 이름 + 토글 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ProviderIcon provider={instance.provider} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {instance.label || instance.instance_id}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{instance.instance_id}</div>
        </div>
        <ToggleSwitch checked={instance.enabled} onChange={onToggle} />
      </div>

      {/* 상태 배지 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {instance.running && <Badge status={t("channels.running")} variant="ok" />}
        <span style={{ fontSize: 11, color: instance.token_configured ? "var(--ok)" : "var(--err)" }}>
          {instance.token_configured ? t("channels.token_configured") : t("channels.no_token")}
        </span>
        {instance.default_target && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{instance.default_target}</span>
        )}
      </div>

      {/* 오류 */}
      {instance.last_error && (
        <div style={{ color: "var(--err)", fontSize: 11 }}>{instance.last_error}</div>
      )}

      {/* 테스트 결과 */}
      {testResult && (
        <div style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
          <Badge status={testResult.ok ? t("channels.pass") : t("channels.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span style={{ color: "var(--muted)" }}>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{isEdit ? t("channels.edit_title") : t("channels.add_title")}</h3>
          <button className="modal__close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
              {!isEdit && <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>
                {t("channels.instance_id_hint")}
              </span>}
            </div>

            <div className="form-group">
              <label className="form-label">{t("channels.label")}</label>
              <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("channels.label_placeholder")} />
            </div>

            <div className="form-group" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
