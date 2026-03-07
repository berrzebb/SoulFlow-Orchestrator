import { Badge } from "../../components/badge";
import { useT } from "../../i18n";
import type { OAuthPreset } from "./types";

export function PresetCard({ preset, onEdit, onRemove }: {
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
