import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge } from "../components/badge";
import { Modal, FormModal } from "../components/modal";
import { useToast } from "../components/toast";
import { useTestMutation } from "../hooks/use-test-mutation";
import { useT } from "../i18n";
import { time_ago } from "../utils/format";

interface OAuthIntegration {
  instance_id: string;
  service_type: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  token_configured: boolean;
  expired: boolean;
  expires_at: string | null;
  has_client_secret: boolean;
  created_at: string;
  updated_at: string;
}

interface OAuthPreset {
  service_type: string;
  label: string;
  auth_url: string;
  token_url: string;
  scopes_available: string[];
  default_scopes: string[];
  supports_refresh: boolean;
  is_builtin?: boolean;
  token_auth_method?: "basic" | "body";
  scope_separator?: " " | ",";
  test_url?: string;
}

type ModalMode = { kind: "add" } | { kind: "edit"; instance: OAuthIntegration };

function parse_csv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function OAuthPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [presetModal, setPresetModal] = useState<OAuthPreset | null | "add">(null);
  const [deleteTarget, setDeleteTarget] = useState<OAuthIntegration | null>(null);
  const [deletePresetTarget, setDeletePresetTarget] = useState<OAuthPreset | null>(null);

  const { data: integrations, isLoading } = useQuery<OAuthIntegration[]>({
    queryKey: ["oauth-integrations"],
    queryFn: () => api.get("/api/oauth/integrations"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: presets = [] } = useQuery<OAuthPreset[]>({
    queryKey: ["oauth-presets"],
    queryFn: () => api.get("/api/oauth/presets"),
    staleTime: 60_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/oauth/integrations/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("oauth.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["oauth-integrations"] }); },
    onError: (err) => toast(t("oauth.remove_failed", { error: err.message }), "err"),
  });

  const removePreset = useMutation({
    mutationFn: (type: string) => api.del(`/api/oauth/presets/${encodeURIComponent(type)}`),
    onSuccess: () => { toast(t("oauth.preset_removed"), "ok"); void qc.invalidateQueries({ queryKey: ["oauth-presets"] }); },
    onError: (err) => toast(t("oauth.preset_remove_failed", { error: err.message }), "err"),
  });

  const builtin_presets = presets.filter((p) => p.is_builtin);
  const custom_presets = presets.filter((p) => !p.is_builtin && p.service_type !== "custom");

  return (
    <div className="page">
      {/* ── Integrations ── */}
      <div className="section-header">
        <h2>{t("oauth.title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          {t("oauth.add")}
        </button>
      </div>

      {isLoading ? (
        <div className="stat-grid stat-grid--wide">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : !integrations?.length ? (
        <div className="empty-state"><div className="empty-state__icon">🔗</div><div className="empty-state__text">{t("oauth.no_integrations")}</div></div>
      ) : (
        <div className="stat-grid stat-grid--wide">
          {integrations.map((inst) => (
            <OAuthCard
              key={inst.instance_id}
              instance={inst}
              presets={presets}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
            />
          ))}
        </div>
      )}

      {/* ── Presets ── */}
      <div className="section-header section-header--spaced">
        <h2>{t("oauth.presets_title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setPresetModal("add")}>
          {t("oauth.add_preset")}
        </button>
      </div>

      <div className="stat-grid stat-grid--wider">
        {builtin_presets.map((p) => (
          <PresetCard key={p.service_type} preset={p} onEdit={() => setPresetModal(p)} onRemove={null} />
        ))}
        {custom_presets.map((p) => (
          <PresetCard
            key={p.service_type}
            preset={p}
            onEdit={() => setPresetModal(p)}
            onRemove={() => setDeletePresetTarget(p)}
          />
        ))}
        {custom_presets.length === 0 && builtin_presets.length === presets.filter((p) => p.service_type !== "custom").length && (
          <div className="empty-state empty-state--span-all"><div className="empty-state__icon">🔧</div><div className="empty-state__text">{t("oauth.no_custom_presets")}</div></div>
        )}
      </div>

      <Modal
        open={!!deleteTarget}
        title={t("oauth.remove_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.instance_id);
          setDeleteTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("oauth.remove_confirm", { label: deleteTarget?.label || deleteTarget?.instance_id || "" })}
        </p>
      </Modal>

      <Modal
        open={!!deletePresetTarget}
        title={t("oauth.preset_remove_title")}
        onClose={() => setDeletePresetTarget(null)}
        onConfirm={() => {
          if (deletePresetTarget) removePreset.mutate(deletePresetTarget.service_type);
          setDeletePresetTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("oauth.preset_remove_confirm", { label: deletePresetTarget?.label || "" })}
        </p>
      </Modal>

      {modal && (
        <OAuthModal
          mode={modal}
          presets={presets}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["oauth-integrations"] });
          }}
        />
      )}

      {presetModal !== null && (
        <PresetModal
          initial={presetModal === "add" ? null : presetModal}
          onClose={() => setPresetModal(null)}
          onSaved={() => {
            setPresetModal(null);
            void qc.invalidateQueries({ queryKey: ["oauth-presets"] });
          }}
        />
      )}
    </div>
  );
}

// ── PresetCard ────────────────────────────────────────────────────────────────

function PresetCard({ preset, onEdit, onRemove }: {
  preset: OAuthPreset;
  onEdit: () => void;
  onRemove: (() => void) | null;
}) {
  const t = useT();

  return (
    <div className="stat-card">
      <div className="stat-card__header stat-card__header--wrap">
        <Badge
          status={preset.is_builtin ? t("oauth.builtin_badge") : t("oauth.custom_badge")}
          variant={preset.is_builtin ? "ok" : "info"}
        />
        <Badge status={preset.service_type} variant="info" />
      </div>
      <div className="stat-card__value stat-card__value--md">{preset.label}</div>
      <div className="stat-card__label stat-card__label--break">
        {preset.auth_url}
      </div>
      {preset.token_auth_method === "basic" && (
        <div className="stat-card__extra">{t("oauth.token_auth_basic")}</div>
      )}
      {preset.default_scopes.length > 0 && (
        <div className="stat-card__tags">
          {preset.default_scopes.map((s) => <Badge key={s} status={s} variant="info" />)}
        </div>
      )}
      <div className="stat-card__actions">
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        {!preset.is_builtin && onRemove && (
          <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
        )}
      </div>
    </div>
  );
}

// ── OAuthCard ─────────────────────────────────────────────────────────────────

function OAuthCard({ instance, presets, onEdit, onRemove }: {
  instance: OAuthIntegration;
  presets: OAuthPreset[];
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [showConnectModal, setShowConnectModal] = useState(false);
  const { toast } = useToast();
  const t = useT();
  const qc = useQueryClient();

  const preset = presets.find((p) => p.service_type === instance.service_type);
  const service_label = preset?.label || instance.service_type;
  const needs_secret_on_connect = preset?.token_auth_method === "basic" && !instance.has_client_secret;

  const connect = useMutation({
    mutationFn: (client_secret?: string) => api.post<{ ok: boolean; auth_url?: string; error?: string }>(
      `/api/oauth/integrations/${encodeURIComponent(instance.instance_id)}/auth`,
      client_secret ? { client_secret } : undefined,
    ),
    onSuccess: (r) => {
      if (r.ok && r.auth_url) {
        window.open(r.auth_url, "oauth_popup", "width=600,height=700");
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["oauth-integrations"] }), 3000);
      } else {
        toast(r.error || t("common.unknown_error"), "err");
      }
    },
    onError: (err) => toast(err.message, "err"),
  });

  const handle_connect_click = () => {
    if (needs_secret_on_connect) {
      setShowConnectModal(true);
    } else {
      connect.mutate(undefined);
    }
  };

  const refresh = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(
      `/api/oauth/integrations/${encodeURIComponent(instance.instance_id)}/refresh`,
    ),
    onSuccess: (r) => {
      toast(r.ok ? t("oauth.refreshed") : t("oauth.refresh_failed", { error: r.error || "" }), r.ok ? "ok" : "err");
      void qc.invalidateQueries({ queryKey: ["oauth-integrations"] });
    },
    onError: (err) => toast(t("oauth.refresh_failed", { error: err.message }), "err"),
  });

  const { testing, testResult, test } = useTestMutation({
    url: `/api/oauth/integrations/${encodeURIComponent(instance.instance_id)}/test`,
    onOk: () => t("oauth.test_passed"),
    onFail: (r) => t("oauth.test_failed", { error: r.error || "" }),
    onError: (err) => t("oauth.test_failed", { error: err.message }),
  });

  const status_variant = instance.token_configured
    ? instance.expired ? "warn" : "ok"
    : "off";
  const status_label = instance.token_configured
    ? instance.expired ? t("oauth.expired") : t("oauth.connected")
    : t("oauth.not_connected");

  return (
    <div className={`stat-card desk--${status_variant}`}>
      <div className="stat-card__header stat-card__header--wrap">
        <Badge status={service_label} variant="info" />
        <Badge status={status_label} variant={status_variant} />
      </div>
      <div className="stat-card__value stat-card__value--md">
        {instance.label || instance.instance_id}
      </div>
      <div className="stat-card__label">{instance.instance_id}</div>
      {instance.scopes.length > 0 && (
        <div className="stat-card__tags">
          {instance.scopes.map((s) => <Badge key={s} status={s} variant="info" />)}
        </div>
      )}
      <div className="text-xs text-muted">
        {instance.expires_at && (
          <span title={instance.expires_at} className={instance.expired ? "text-warn" : ""}>
            {instance.expired ? t("oauth.expired_at") : t("oauth.expires_at")} {time_ago(instance.expires_at)}
          </span>
        )}
        {instance.expires_at && instance.updated_at && " · "}
        {instance.updated_at && (
          <span title={instance.updated_at}>{time_ago(instance.updated_at)}</span>
        )}
      </div>
      {testResult && (
        <div className="stat-card__tags">
          <Badge status={testResult.ok ? "pass" : "fail"} variant={testResult.ok ? "ok" : "err"} />
          <span>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}
      {showConnectModal && (
        <ConnectModal
          onClose={() => setShowConnectModal(false)}
          onConnect={(secret) => { setShowConnectModal(false); connect.mutate(secret); }}
        />
      )}
      <div className="stat-card__actions">
        <button className="btn btn--xs btn--accent" onClick={handle_connect_click} disabled={connect.isPending}>
          {connect.isPending ? t("oauth.connecting") : t("oauth.connect")}
        </button>
        {instance.token_configured && (
          <>
            <button className="btn btn--xs" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
              {refresh.isPending ? t("oauth.refreshing") : t("common.refresh")}
            </button>
            <button className="btn btn--xs btn--ok" onClick={() => test()} disabled={testing}>
              {testing ? t("common.testing") : t("common.test")}
            </button>
          </>
        )}
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
      </div>
    </div>
  );
}

// ── OAuthModal (Integration 추가/수정) ────────────────────────────────────────

function OAuthModal({ mode, presets, onClose, onSaved }: {
  mode: ModalMode;
  presets: OAuthPreset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.instance : null;
  const t = useT();

  const [serviceType, setServiceType] = useState(initial?.service_type || (presets[0]?.service_type ?? "github"));
  const [label, setLabel] = useState(initial?.label || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopeText, setScopeText] = useState((initial?.scopes ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const active_preset = presets.find((p) => p.service_type === serviceType);
  const available_scopes = active_preset?.scopes_available ?? [];
  const is_custom = serviceType === "custom";
  const is_basic_auth = active_preset?.token_auth_method === "basic";

  const selected_scopes = new Set(parse_csv(scopeText));
  const is_scope_selected = (s: string) => selected_scopes.has(s);

  const handle_service_change = (type: string) => {
    setServiceType(type);
    const preset = presets.find((p) => p.service_type === type);
    if (preset) {
      setScopeText(preset.default_scopes.join(", "));
      if (type !== "custom") {
        setAuthUrl(preset.auth_url);
        setTokenUrl(preset.token_url);
      }
    }
  };

  const toggle_scope = (s: string) => {
    const current = parse_csv(scopeText);
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
    setScopeText(next.join(", "));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/api/oauth/integrations/${encodeURIComponent(initial!.instance_id)}`, {
          label: label || initial!.instance_id,
          enabled,
          scopes: parse_csv(scopeText),
        });
        toast(t("oauth.updated"), "ok");
      } else {
        const body: Record<string, unknown> = {
          service_type: serviceType,
          label: label || serviceType,
          client_id: clientId,
          scopes: parse_csv(scopeText),
        };
        if (clientSecret) body.client_secret = clientSecret;
        if (is_custom) {
          body.auth_url = authUrl;
          body.token_url = tokenUrl;
        }
        await api.post("/api/oauth/integrations", body);
        toast(t("oauth.added"), "ok");
      }
      onSaved();
    } catch (err) {
      toast(t("oauth.save_failed", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      title={isEdit ? t("oauth.edit_title") : t("oauth.add_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? t("common.save") : t("common.add")}
      saving={saving}
    >
      <div className="form-group">
        <label className="form-label">{t("oauth.service_type")}</label>
        {isEdit ? (
          <input className="form-input" value={active_preset?.label || serviceType} disabled />
        ) : (
          <select className="form-input" value={serviceType} onChange={(e) => handle_service_change(e.target.value)}>
            {presets.map((p) => (
              <option key={p.service_type} value={p.service_type}>{p.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">{t("oauth.label")}</label>
        <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={serviceType} />
      </div>

      {isEdit && (
        <div className="form-group">
          <label className="form-label">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {" "}{t("common.enabled")}
          </label>
        </div>
      )}

      {!isEdit && (
        <>
          <div className="form-group">
            <label className="form-label">{t("oauth.client_id")}</label>
            <input className="form-input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t("oauth.client_id_placeholder")} required autoComplete="off" />
          </div>
          {!is_basic_auth && (
            <div className="form-group">
              <label className="form-label">
                {t("oauth.client_secret")}
                <span className="form-label__optional"> ({t("common.optional")})</span>
              </label>
              <input className="form-input" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={t("oauth.client_secret_placeholder")} autoComplete="off" />
            </div>
          )}
          {is_basic_auth && <p className="form-hint">{t("oauth.client_secret_hint")}</p>}
        </>
      )}

      {is_custom && !isEdit && (
        <>
          <div className="form-group">
            <label className="form-label">{t("oauth.auth_url")}</label>
            <input className="form-input" value={authUrl} onChange={(e) => setAuthUrl(e.target.value)} placeholder="https://..." required />
            <span className="form-hint">{t("oauth.custom_url_hint")}</span>
          </div>
          <div className="form-group">
            <label className="form-label">{t("oauth.token_url")}</label>
            <input className="form-input" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} placeholder="https://..." required />
          </div>
        </>
      )}

      <div className="form-group">
        <label className="form-label">{t("oauth.scopes")}</label>
        {available_scopes.length > 0 && (
          <div className="checkbox-group mb-2">
            {available_scopes.map((s) => (
              <label key={s} className="checkbox-label">
                <input type="checkbox" checked={is_scope_selected(s)} onChange={() => toggle_scope(s)} />
                {s}
              </label>
            ))}
          </div>
        )}
        <input className="form-input" value={scopeText} onChange={(e) => setScopeText(e.target.value)} placeholder={t("oauth.scopes_hint")} />
      </div>
    </FormModal>
  );
}

// ── PresetModal (프리셋 추가) ─────────────────────────────────────────────────

function PresetModal({ initial, onClose, onSaved }: {
  initial: OAuthPreset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = initial !== null;
  const t = useT();
  const { toast } = useToast();

  const [serviceType, setServiceType] = useState(initial?.service_type ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [authUrl, setAuthUrl] = useState(initial?.auth_url ?? "");
  const [tokenUrl, setTokenUrl] = useState(initial?.token_url ?? "");
  const [tokenAuthMethod, setTokenAuthMethod] = useState<"body" | "basic">(initial?.token_auth_method ?? "body");
  const [scopeSeparator, setScopeSeparator] = useState<" " | ",">(initial?.scope_separator ?? " ");
  const [testUrl, setTestUrl] = useState(initial?.test_url ?? "");
  const [scopesAvailable, setScopesAvailable] = useState((initial?.scopes_available ?? []).join(", "));
  const [defaultScopes, setDefaultScopes] = useState((initial?.default_scopes ?? []).join(", "));
  const [supportsRefresh, setSupportsRefresh] = useState(initial?.supports_refresh ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/api/oauth/presets/${encodeURIComponent(initial.service_type)}`, {
          auth_url: authUrl.trim(),
          token_url: tokenUrl.trim(),
          token_auth_method: tokenAuthMethod,
          scope_separator: scopeSeparator,
          test_url: testUrl.trim() || undefined,
          scopes_available: parse_csv(scopesAvailable),
          default_scopes: parse_csv(defaultScopes),
          supports_refresh: supportsRefresh,
        });
        toast(t("oauth.preset_updated"), "ok");
      } else {
        await api.post("/api/oauth/presets", {
          service_type: serviceType.trim(),
          label: label.trim(),
          auth_url: authUrl.trim(),
          token_url: tokenUrl.trim(),
          token_auth_method: tokenAuthMethod,
          scope_separator: scopeSeparator,
          test_url: testUrl.trim() || undefined,
          scopes_available: parse_csv(scopesAvailable),
          default_scopes: parse_csv(defaultScopes),
          supports_refresh: supportsRefresh,
        });
        toast(t("oauth.preset_added"), "ok");
      }
      onSaved();
    } catch (err) {
      toast(t("oauth.preset_save_failed", { error: err instanceof Error ? err.message : String(err) }), "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormModal
      open
      title={isEdit ? t("oauth.preset_edit_title") : t("oauth.preset_add_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? t("common.save") : t("common.add")}
      saving={saving}
    >
      <div className="form-group">
        <label className="form-label">{t("oauth.service_type")}</label>
        <input className="form-input" value={serviceType} onChange={(e) => !isEdit && setServiceType(e.target.value)} placeholder="e.g. notion, dropbox" disabled={isEdit} required={!isEdit} />
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.label")}</label>
        <input className="form-input" value={label} onChange={(e) => !isEdit && setLabel(e.target.value)} placeholder="e.g. Notion" disabled={isEdit} required={!isEdit} />
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.auth_url")}</label>
        <input className="form-input" value={authUrl} onChange={(e) => setAuthUrl(e.target.value)} placeholder="https://..." required />
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.token_url")}</label>
        <input className="form-input" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} placeholder="https://..." required />
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.token_auth_method")}</label>
        <select className="form-input" value={tokenAuthMethod} onChange={(e) => setTokenAuthMethod(e.target.value as "body" | "basic")}>
          <option value="body">{t("oauth.token_auth_body")}</option>
          <option value="basic">{t("oauth.token_auth_basic")}</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.scope_separator")}</label>
        <select className="form-input" value={scopeSeparator} onChange={(e) => setScopeSeparator(e.target.value as " " | ",")}>
          <option value=" ">{t("oauth.scope_sep_space")}</option>
          <option value=",">{t("oauth.scope_sep_comma")}</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.test_url")}</label>
        <input className="form-input" value={testUrl} onChange={(e) => setTestUrl(e.target.value)} placeholder="https://... (optional)" />
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.scopes_available")}</label>
        <input className="form-input" value={scopesAvailable} onChange={(e) => setScopesAvailable(e.target.value)} placeholder={t("oauth.scopes_hint")} />
      </div>
      <div className="form-group">
        <label className="form-label">{t("oauth.default_scopes")}</label>
        <input className="form-input" value={defaultScopes} onChange={(e) => setDefaultScopes(e.target.value)} placeholder={t("oauth.scopes_hint")} />
      </div>
      <div className="form-group">
        <label className="form-label">
          <input type="checkbox" checked={supportsRefresh} onChange={(e) => setSupportsRefresh(e.target.checked)} />
          {" "}{t("oauth.supports_refresh")}
        </label>
      </div>
    </FormModal>
  );
}

// ── ConnectModal (Basic Auth 방식 — Connect 시 client_secret 입력) ─────────────

function ConnectModal({ onClose, onConnect }: {
  onClose: () => void;
  onConnect: (client_secret: string) => void;
}) {
  const t = useT();
  const [clientSecret, setClientSecret] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (clientSecret.trim()) onConnect(clientSecret.trim());
  }

  return (
    <FormModal
      open
      title={t("oauth.connect")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t("oauth.connect")}
    >
      <div className="form-group">
        <label className="form-label">{t("oauth.client_secret")}</label>
        <input
          className="form-input"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={t("oauth.client_secret_placeholder")}
          required
          autoComplete="off"
          autoFocus
        />
      </div>
    </FormModal>
  );
}
