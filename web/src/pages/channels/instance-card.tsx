import { Badge } from "../../components/badge";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useTestMutation } from "../../hooks/use-test-mutation";
import { useT } from "../../i18n";
import { PROVIDER_COLORS } from "../../utils/constants";
import { time_ago } from "../../utils/format";
import type { ChannelInstance } from "./types";

function ProviderIcon({ provider }: { provider: string }) {
  const color = PROVIDER_COLORS[provider] ?? "var(--accent)";
  const label = provider.charAt(0).toUpperCase();
  return (
    <span className="provider-icon" style={{ "--icon-c": color } as React.CSSProperties}>
      {label}
    </span>
  );
}

interface InstanceCardProps {
  instance: ChannelInstance;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
}

export function InstanceCard({ instance, onEdit, onRemove, onToggle }: InstanceCardProps) {
  const t = useT();

  const { testing, testResult, test } = useTestMutation({
    url: `/api/channels/instances/${encodeURIComponent(instance.instance_id)}/test`,
    onOk: (r) => `${instance.label}: ${r.detail || t("channels.connected")}`,
    onFail: (r) => `${instance.label}: ${r.error || ""}`,
    onError: () => t("channels.test_failed"),
  });

  const status_cls = instance.running ? "ok" : "off";

  return (
    <div className={`stat-card desk--${status_cls}${instance.enabled ? "" : " stat-card--disabled"}`}>
      <div className="stat-card__header">
        <ProviderIcon provider={instance.provider} />
        <ToggleSwitch checked={instance.enabled} onChange={onToggle} aria-label={t("common.enabled")} />
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
        <div className="text-xs text-err truncate" title={instance.last_error}>{instance.last_error}</div>
      )}
      {instance.updated_at && (
        <div className="text-xs text-muted" title={instance.updated_at}>{time_ago(instance.updated_at)}</div>
      )}
      {testResult && (
        <div className="stat-card__tags">
          <Badge status={testResult.ok ? t("channels.pass") : t("channels.fail")} variant={testResult.ok ? "ok" : "err"} />
          <span className="text-muted">{testResult.ok ? testResult.detail : testResult.error}</span>
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
