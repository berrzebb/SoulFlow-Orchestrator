import { useState } from "react";
import { api } from "../../api/client";
import { FormModal } from "../../components/modal";
import { FormLabel } from "../../components/form-label";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { OAuthPreset, ModalMode } from "./types";
import { parse_csv } from "./types";

export function OAuthModal({ mode, presets, onClose, onSaved }: {
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
      // 폼 초기화 (신규 추가 후 모달이 닫히면 다음 오픈 시 깨끗한 폼 준비)
      if (!isEdit) {
        setLabel("");
        setClientId("");
        setClientSecret("");
        setAuthUrl("");
        setTokenUrl("");
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
        <FormLabel label={t("oauth.label")} required />
        <input autoFocus className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={serviceType} required aria-required="true" />
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
            <FormLabel label={t("oauth.client_id")} required />
            <input className="form-input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t("oauth.client_id_placeholder")} required aria-required="true" autoComplete="off" />
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
            <FormLabel label={t("oauth.auth_url")} required />
            <input className="form-input" value={authUrl} onChange={(e) => setAuthUrl(e.target.value)} placeholder="https://..." required aria-required="true" />
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
