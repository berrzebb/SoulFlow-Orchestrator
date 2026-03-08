import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { FormModal } from "../../components/modal";
import { FormGroup } from "../../components/form-group";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useT } from "../../i18n";
import { useAsyncState } from "../../hooks/use-async-state";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../../utils/constants";
import type { ConnectionModalMode } from "./types";

interface ConnectionModalProps {
  mode: ConnectionModalMode;
  onClose: () => void;
  onSaved: () => void;
}

export function ConnectionModal({ mode, onClose, onSaved }: ConnectionModalProps) {
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.connection : null;
  const t = useT();

  const { data: types = [] } = useQuery<string[]>({
    queryKey: ["agent-provider-types"],
    queryFn: () => api.get("/api/agents/providers/types"),
  });

  const [providerType, setProviderType] = useState(initial?.provider_type || "claude_sdk");
  const [connectionId, setConnectionId] = useState(initial?.connection_id || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [apiBase, setApiBase] = useState(initial?.api_base || "");
  const [token, setToken] = useState("");
  const { pending: saving, run } = useAsyncState();

  const typeOptions = types.length > 0 ? types : Object.keys(TYPE_LABELS);
  const showApiBase = providerType === "openai_compatible" || providerType === "openrouter";

  const hasChanges = (): boolean => {
    if (!isEdit) return true;
    if (label !== (initial?.label || "")) return true;
    if (enabled !== (initial?.enabled ?? true)) return true;
    if (apiBase !== (initial?.api_base || "")) return true;
    if (token !== "") return true;
    return false;
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const id = isEdit ? initial!.connection_id : (connectionId || providerType);
      const body = {
        provider_type: providerType,
        label: label || id,
        enabled,
        ...(showApiBase && apiBase ? { api_base: apiBase } : {}),
        ...(token ? { token } : {}),
      };
      if (isEdit) {
        await api.put(`/api/agents/connections/${encodeURIComponent(id)}`, body);
      } else {
        await api.post("/api/agents/connections", { connection_id: id, ...body });
      }
      onSaved();
    }, isEdit ? t("connections.updated") : t("connections.added"),
      (e) => t("providers.save_failed", { error: e instanceof Error ? e.message : String(e) }));
  }

  return (
    <FormModal
      open
      title={isEdit ? t("connections.edit_title") : t("connections.add_title")}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? t("common.save") : t("common.add")}
      saving={saving}
      submitDisabled={!hasChanges()}
    >
      <FormGroup label={t("providers.provider_type")}>
        {isEdit ? (
          <input className="form-input" value={TYPE_LABELS[providerType] || providerType} disabled title={t("common.cannot_edit_after_creation")} />
        ) : (
          <select className="form-input" value={providerType} onChange={(e) => setProviderType(e.target.value)}>
            {typeOptions.map((tp) => <option key={tp} value={tp}>{TYPE_LABELS[tp] || tp}</option>)}
          </select>
        )}
      </FormGroup>

      <FormGroup label={t("connections.connection_id")} hint={!isEdit ? t("connections.connection_id_hint") : undefined}>
        <input
          className="form-input"
          value={connectionId || (isEdit ? initial!.connection_id : "")}
          onChange={(e) => setConnectionId(e.target.value)}
          disabled={isEdit}
          title={isEdit ? t("common.cannot_edit_after_creation") : undefined}
          placeholder={providerType}
        />
      </FormGroup>

      <FormGroup label={t("providers.label")}>
        <input autoFocus className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("providers.label_placeholder")} />
      </FormGroup>

      <FormGroup label={t("common.enabled")} className="form-group--row">
        <ToggleSwitch checked={enabled} onChange={setEnabled} aria-label={t("common.enabled")} />
      </FormGroup>

      {showApiBase && (
        <FormGroup label={t("providers.api_base")} hint={t("providers.api_base_hint")}>
          <input className="form-input" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.openai.com/v1" />
        </FormGroup>
      )}

      <FormGroup label={t("providers.api_token")}>
        <input
          className="form-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={isEdit ? t("providers.token_placeholder_edit") : t("providers.token_placeholder_new")}
          autoComplete="off"
        />
      </FormGroup>
    </FormModal>
  );
}
