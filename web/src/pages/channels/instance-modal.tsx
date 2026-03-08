import { useState } from "react";
import { FormModal } from "../../components/modal";
import { FormLabel } from "../../components/form-label";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { api } from "../../api/client";
import { PROVIDER_OPTIONS } from "./types";
import type { ModalMode } from "./types";

interface InstanceModalProps {
  mode: ModalMode;
  onClose: () => void;
  onSaved: () => void;
}

export function InstanceModal({ mode, onClose, onSaved }: InstanceModalProps) {
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

  // 변경사항 감지: 현재 값이 초기값과 다른지 확인
  const hasChanges = (): boolean => {
    if (!isEdit) return true; // 신규 추가는 항상 변경사항으로 간주
    if (label !== (initial?.label || "")) return true;
    if (enabled !== (initial?.enabled ?? true)) return true;
    if (token !== "") return true; // 토큰 필드 수정 감지
    if (defaultTarget !== String(initial?.settings?.default_channel || initial?.settings?.default_chat_id || "")) return true;
    if (apiBase !== String(initial?.settings?.api_base || "")) return true;
    return false;
  };

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = isEdit ? initial!.instance_id : (instanceId || provider);
      if (isEdit) {
        await api.put(`/api/channels/instances/${encodeURIComponent(id)}`, {
          label, enabled, settings: build_settings(),
          ...(token ? { token } : {}),
        });
      } else {
        await api.post("/api/channels/instances", {
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
      submitDisabled={!hasChanges()}
    >
      <div className="form-group">
        <label className="form-label">{t("channels.provider")}</label>
        {isEdit ? (
          <input className="form-input" value={provider} disabled title={t("common.cannot_edit_after_creation")} />
        ) : (
          <select className="form-input" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      <div className="form-group">
        <FormLabel label={t("channels.instance_id")} required />
        <input
          className="form-input"
          value={auto_id ? provider : instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          disabled={isEdit}
          title={isEdit ? t("common.cannot_edit_after_creation") : undefined}
          placeholder={provider}
          required
          aria-required="true"
        />
        {!isEdit && <span className="form-hint">{t("channels.instance_id_hint")}</span>}
      </div>

      <div className="form-group">
        <FormLabel label={t("channels.label")} required />
        <input autoFocus className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("channels.label_placeholder")} required aria-required="true" />
      </div>

      <div className="form-group form-group--row">
        <label className="form-label">{t("common.enabled")}</label>
        <ToggleSwitch checked={enabled} onChange={setEnabled} aria-label={t("common.enabled")} />
      </div>

      <div className="form-group">
        <FormLabel label={t("channels.bot_token")} required />
        <input
          className="form-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={isEdit ? t("channels.bot_token_placeholder_edit") : t("channels.bot_token_placeholder_new")}
          autoComplete="off"
          required
          aria-required="true"
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
