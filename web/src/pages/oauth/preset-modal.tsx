import { useState } from "react";
import { api } from "../../api/client";
import { FormModal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { OAuthPreset } from "./types";
import { parse_csv } from "./types";

export function PresetModal({ initial, onClose, onSaved }: {
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
