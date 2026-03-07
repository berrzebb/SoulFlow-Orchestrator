import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { FormModal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useTestMutation } from "../../hooks/use-test-mutation";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";
import type { OAuthIntegration, OAuthPreset } from "./types";

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

export function OAuthCard({ instance, presets, onEdit, onRemove }: {
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
