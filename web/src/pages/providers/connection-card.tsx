import { Badge } from "../../components/badge";
import { useTestMutation } from "../../hooks/use-test-mutation";
import { useT } from "../../i18n";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../../utils/constants";
import { time_ago } from "../../utils/format";
import type { ProviderConnection } from "./types";

interface ConnectionCardProps {
  connection: ProviderConnection;
  onEdit: () => void;
  onRemove: () => void;
}

export function ConnectionCard({ connection, onEdit, onRemove }: ConnectionCardProps) {
  const t = useT();

  const { testing, testResult, test } = useTestMutation({
    url: `/api/agents/connections/${encodeURIComponent(connection.connection_id)}/test`,
    onOk: (r) => `${connection.label}: ${r.detail || t("providers.available")}`,
    onFail: (r) => `${connection.label}: ${r.error || ""}`,
    onError: () => t("providers.test_failed"),
  });

  const status_cls = connection.enabled && connection.token_configured ? "ok" : connection.enabled ? "warn" : "off";

  return (
    <div className={`stat-card desk--${status_cls}`}>
      <div className="stat-card__header stat-card__header--wrap">
        <Badge status={TYPE_LABELS[connection.provider_type] || connection.provider_type} variant="info" />
        <Badge status={connection.enabled ? t("providers.on") : t("providers.off")} variant={connection.enabled ? "ok" : "off"} />
      </div>
      <div className="stat-card__value stat-card__value--md">
        {connection.label || connection.connection_id}
      </div>
      <div className="stat-card__label">{connection.connection_id}</div>
      <div className="stat-card__extra">
        {connection.api_base && (
          <><span className="text-accent">{connection.api_base}</span>{" · "}</>
        )}
        {connection.token_configured
          ? <span className="text-ok">{t("providers.token_configured")}</span>
          : <span className="text-err">{t("providers.no_token")}</span>
        }
        {" · "}
        <span className="text-muted">{t("connections.preset_count", { count: String(connection.preset_count) })}</span>
      </div>
      {connection.updated_at && (
        <div className="text-xs text-muted" title={connection.updated_at}>{time_ago(connection.updated_at)}</div>
      )}
      {testResult && (
        <div className="stat-card__tags">
          <Badge status={testResult.ok ? t("providers.pass") : t("providers.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span>{testResult.ok ? testResult.detail : testResult.error}</span>
        </div>
      )}
      <div className="stat-card__actions">
        <button className="btn btn--xs" onClick={onEdit}>{t("common.edit")}</button>
        <button className="btn btn--xs btn--ok" onClick={() => test()} disabled={testing || !connection.token_configured}>
          {testing ? t("common.testing") : t("common.test")}
        </button>
        <button className="btn btn--xs btn--danger" onClick={onRemove}>{t("common.remove")}</button>
      </div>
    </div>
  );
}
