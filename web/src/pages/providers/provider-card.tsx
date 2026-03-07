import { useState } from "react";
import { Badge } from "../../components/badge";
import { useTestMutation } from "../../hooks/use-test-mutation";
import { useT } from "../../i18n";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../../utils/constants";
import { time_ago } from "../../utils/format";
import type { ProviderInstance } from "./types";

interface ProviderCardProps {
  instance: ProviderInstance;
  onEdit: () => void;
  onRemove: () => void;
}

export function ProviderCard({ instance, onEdit, onRemove }: ProviderCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const { testing, testResult, test } = useTestMutation({
    url: `/api/agents/providers/${encodeURIComponent(instance.instance_id)}/test`,
    onOk: (r) => `${instance.label}: ${r.detail || t("providers.available")}`,
    onFail: (r) => `${instance.label}: ${r.error || ""}`,
    onError: () => t("providers.test_failed"),
  });

  const status_cls = instance.available ? "ok" : instance.enabled ? "warn" : "off";
  const has_details = instance.supported_modes.length > 0
    || (instance.capabilities && Object.keys(instance.capabilities).length > 0);

  return (
    <div className={`stat-card desk--${status_cls}`}>
      <div className="stat-card__header stat-card__header--wrap">
        <Badge status={TYPE_LABELS[instance.provider_type] || instance.provider_type} variant="info" />
        <Badge
          status={instance.model_purpose === "embedding" ? t("providers.purpose_embedding") : t("providers.purpose_chat")}
          variant={instance.model_purpose === "embedding" ? "warn" : "info"}
        />
        <span className="stat-card__tags mt-0 mb-0">
          <Badge status={instance.enabled ? t("providers.on") : t("providers.off")} variant={instance.enabled ? "ok" : "off"} />
          {instance.available && <Badge status={t("providers.available")} variant="ok" />}
          {instance.circuit_state !== "closed" && (
            <Badge status={instance.circuit_state} variant={instance.circuit_state === "open" ? "err" : "warn"} />
          )}
        </span>
      </div>
      <div className="stat-card__value stat-card__value--md">
        {instance.label || instance.instance_id}
      </div>
      <div className="stat-card__label">{instance.instance_id}</div>
      <div className="stat-card__extra">
        {typeof instance.settings?.model === "string" && instance.settings.model && (
          <><span className="text-accent">{instance.settings.model}</span>{" · "}</>
        )}
        {instance.token_configured
          ? <span className="text-ok">{t("providers.token_configured")}</span>
          : <span className="text-err">{t("providers.no_token")}</span>
        }
        {" · "}
        <span className="text-muted">{t("providers.priority")}: {instance.priority}</span>
        {has_details && (
          <button
            className="provider-card__expand"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t("common.collapse") : t("common.expand")}
          >
            {expanded ? "▾" : "▸"} {t("providers.details")}
          </button>
        )}
      </div>
      {expanded && (
        <>
          {instance.supported_modes.length > 0 && (
            <div className="stat-card__tags">
              {instance.supported_modes.map((m) => <Badge key={m} status={m} variant="info" />)}
            </div>
          )}
          {instance.capabilities && Object.keys(instance.capabilities).length > 0 && (
            <div className="stat-card__tags">
              {Object.entries(instance.capabilities).map(([cap, ok]) => (
                <Badge key={cap} status={cap} variant={ok ? "ok" : "off"} />
              ))}
            </div>
          )}
        </>
      )}
      {instance.updated_at && (
        <div className="text-xs text-muted" title={instance.updated_at}>{time_ago(instance.updated_at)}</div>
      )}
      {testResult && (
        <div className="stat-card__tags">
          <Badge status={testResult.ok ? t("providers.pass") : t("providers.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}
      <div className="stat-card__actions">
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        <button className="btn btn--xs btn--ok" onClick={() => test()} disabled={testing || !instance.token_configured}>
          {testing ? t("common.testing") : t("common.test")}
        </button>
        <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
      </div>
    </div>
  );
}
