import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Modal } from "../../components/modal";
import { ResourceCard } from "../../components/resource-card";
import { Badge } from "../../components/badge";
import { FormModal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { useResourceCRUD } from "../../hooks/use-resource-crud";
import { time_ago } from "../../utils/format";
import type { OAuthIntegration, OAuthPreset, ModalMode } from "./types";
import { OAuthModal } from "./oauth-modal";
import { PresetModal } from "./preset-modal";

export default function OAuthPage() {
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [presetModal, setPresetModal] = useState<OAuthPreset | null | "add">(null);
  const [connectShowSecret, setConnectShowSecret] = useState<string | null>(null);
  const [connectSecret, setConnectSecret] = useState("");

  const { items: integrations, isLoading, deleteTarget, setDeleteTarget, remove, queryClient: qc } = useResourceCRUD<OAuthIntegration>({
    queryKey: ["oauth-integrations"],
    queryFn: () => api.get("/api/oauth/integrations"),
    deleteEndpoint: (id) => `/api/oauth/integrations/${encodeURIComponent(id)}`,
    onDeleteSuccess: () => toast(t("oauth.removed"), "ok"),
    onDeleteError: (err) => toast(t("oauth.remove_failed", { error: err.message }), "err"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { items: presets = [], deleteTarget: deletePresetTarget, setDeleteTarget: setDeletePresetTarget, remove: removePreset } = useResourceCRUD<OAuthPreset>({
    queryKey: ["oauth-presets"],
    queryFn: () => api.get("/api/oauth/presets"),
    deleteEndpoint: (type) => `/api/oauth/presets/${encodeURIComponent(type)}`,
    onDeleteSuccess: () => toast(t("oauth.preset_removed"), "ok"),
    onDeleteError: (err) => toast(t("oauth.preset_remove_failed", { error: err.message }), "err"),
    staleTime: 60_000,
  });

  // OAuth connect/refresh logic
  const connect = useMutation({
    mutationFn: (data: { instance_id: string; client_secret?: string }) =>
      api.post<{ ok: boolean; auth_url?: string; error?: string }>(
        `/api/oauth/integrations/${encodeURIComponent(data.instance_id)}/auth`,
        data.client_secret ? { client_secret: data.client_secret } : undefined,
      ),
    onSuccess: (r) => {
      if (r.ok && r.auth_url) {
        window.open(r.auth_url, "oauth_popup", "width=600,height=700");
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["oauth-integrations"] }), 3000);
      } else {
        toast(r.error || t("common.unknown_error"), "err");
      }
      setConnectShowSecret(null);
      setConnectSecret("");
    },
    onError: (err) => toast((err as Error).message, "err"),
  });

  const refresh = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; error?: string }>(`/api/oauth/integrations/${encodeURIComponent(id)}/refresh`),
    onSuccess: (r) => {
      toast(r.ok ? t("oauth.refreshed") : t("oauth.refresh_failed", { error: r.error || "" }), r.ok ? "ok" : "err");
      void qc.invalidateQueries({ queryKey: ["oauth-integrations"] });
    },
    onError: (err) => toast(t("oauth.refresh_failed", { error: (err as Error).message }), "err"),
  });

  const test = useMutation({
    mutationFn: (id: string) => api.post(`/api/oauth/integrations/${encodeURIComponent(id)}/test`),
    onSuccess: () => toast(t("oauth.test_passed"), "ok"),
    onError: (err) => toast(t("oauth.test_failed", { error: (err as Error).message }), "err"),
  });

  const builtin_presets = presets.filter((p) => p.is_builtin);
  const custom_presets = presets.filter((p) => !p.is_builtin && p.service_type !== "custom");

  return (
    <div className="page">
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
        <div className="empty-state">
          <div className="empty-state__icon">🔗</div>
          <div className="empty-state__text">{t("oauth.no_integrations")}</div>
        </div>
      ) : (
        <div className="stat-grid stat-grid--wide">
          {integrations.map((inst) => {
            const preset = presets.find((p) => p.service_type === inst.service_type);
            const statusVariant = inst.token_configured ? (inst.expired ? "warn" : "ok") : "off";
            const statusLabel = inst.token_configured ? (inst.expired ? t("oauth.expired") : t("oauth.connected")) : t("oauth.not_connected");
            const needsSecret = preset?.token_auth_method === "basic" && !inst.has_client_secret;

            return (
              <ResourceCard
                key={inst.instance_id}
                resourceId={inst.instance_id}
                title={inst.label || inst.instance_id}
                subtitle={inst.instance_id}
                statusVariant={statusVariant}
                statusLabel={statusLabel}
                badges={[
                  { label: preset?.label || inst.service_type, variant: "info" },
                  ...(inst.token_configured && inst.expired ? [{ label: t("oauth.expired"), variant: "warn" }] : []),
                ]}
                testUrl={inst.token_configured ? `/api/oauth/integrations/${encodeURIComponent(inst.instance_id)}/test` : undefined}
                onTestSuccess={() => t("oauth.test_passed")}
                onTestFail={(err) => err}
                onEdit={() => setModal({ kind: "edit", instance: inst })}
                onRemove={() => setDeleteTarget(inst)}
              >
                {inst.scopes.length > 0 && (
                  <div className="stat-card__tags">
                    {inst.scopes.map((s) => (
                      <Badge key={s} status={s} variant="info" />
                    ))}
                  </div>
                )}
                <div className="stat-card__extra text-xs text-muted">
                  {inst.expires_at && (
                    <span title={inst.expires_at} className={inst.expired ? "text-warn" : ""}>
                      {inst.expired ? t("oauth.expired_at") : t("oauth.expires_at")} {time_ago(inst.expires_at)}
                    </span>
                  )}
                  {inst.expires_at && inst.updated_at && " · "}
                  {inst.updated_at && (
                    <span title={inst.updated_at}>{time_ago(inst.updated_at)}</span>
                  )}
                </div>
                {/* Additional actions for OAuth */}
                <div className="stat-card__actions" style={{ marginTop: "var(--sp-2)" }}>
                  <button
                    className="btn btn--xs btn--accent"
                    onClick={() => {
                      if (needsSecret) {
                        setConnectShowSecret(inst.instance_id);
                      } else {
                        connect.mutate({ instance_id: inst.instance_id });
                      }
                    }}
                    disabled={connect.isPending}
                    aria-label={t("oauth.connect")}
                  >
                    {connect.isPending ? t("oauth.connecting") : t("oauth.connect")}
                  </button>
                  {inst.token_configured && (
                    <>
                      <button
                        className="btn btn--xs"
                        onClick={() => refresh.mutate(inst.instance_id)}
                        disabled={refresh.isPending}
                        aria-label={t("common.refresh")}
                      >
                        {refresh.isPending ? t("oauth.refreshing") : t("common.refresh")}
                      </button>
                      <button
                        className="btn btn--xs btn--ok"
                        onClick={() => test.mutate(inst.instance_id)}
                        disabled={test.isPending}
                        aria-label={t("common.test")}
                      >
                        {test.isPending ? t("common.testing") : t("common.test")}
                      </button>
                    </>
                  )}
                </div>
              </ResourceCard>
            );
          })}
        </div>
      )}

      <div className="section-header section-header--spaced">
        <h2>{t("oauth.presets_title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setPresetModal("add")}>
          {t("oauth.add_preset")}
        </button>
      </div>

      <div className="stat-grid stat-grid--wider">
        {builtin_presets.map((p) => (
          <ResourceCard
            key={p.service_type}
            resourceId={p.service_type}
            title={p.label}
            statusVariant={p.is_builtin ? "ok" : "info"}
            statusLabel={p.is_builtin ? t("oauth.builtin_badge") : t("oauth.custom_badge")}
            badges={[{ label: p.service_type, variant: "info" }]}
            onEdit={() => setPresetModal(p)}
            onRemove={() => null}
          >
            <div className="stat-card__label">{p.auth_url}</div>
            {p.token_auth_method === "basic" && (
              <div className="stat-card__extra">{t("oauth.token_auth_basic")}</div>
            )}
            {p.default_scopes.length > 0 && (
              <div className="stat-card__tags">
                {p.default_scopes.map((s) => (
                  <Badge key={s} status={s} variant="info" />
                ))}
              </div>
            )}
          </ResourceCard>
        ))}
        {custom_presets.map((p) => (
          <ResourceCard
            key={p.service_type}
            resourceId={p.service_type}
            title={p.label}
            statusVariant="info"
            statusLabel={t("oauth.custom_badge")}
            badges={[{ label: p.service_type, variant: "info" }]}
            onEdit={() => setPresetModal(p)}
            onRemove={() => setDeletePresetTarget(p)}
          >
            <div className="stat-card__label">{p.auth_url}</div>
            {p.default_scopes.length > 0 && (
              <div className="stat-card__tags">
                {p.default_scopes.map((s) => (
                  <Badge key={s} status={s} variant="info" />
                ))}
              </div>
            )}
          </ResourceCard>
        ))}
        {custom_presets.length === 0 && builtin_presets.length === presets.filter((p) => p.service_type !== "custom").length && (
          <div className="empty-state empty-state--span-all">
            <div className="empty-state__icon">🔧</div>
            <div className="empty-state__text">{t("oauth.no_custom_presets")}</div>
          </div>
        )}
      </div>

      {/* Connect secret modal */}
      {connectShowSecret && (
        <FormModal
          open
          title={t("oauth.connect")}
          onClose={() => { setConnectShowSecret(null); setConnectSecret(""); }}
          onSubmit={(e) => {
            e.preventDefault();
            if (connectShowSecret) {
              connect.mutate({ instance_id: connectShowSecret, client_secret: connectSecret.trim() });
            }
          }}
          submitLabel={t("oauth.connect")}
          saving={connect.isPending}
        >
          <div className="form-group">
            <label className="form-label">{t("oauth.client_secret")}</label>
            <input
              className="form-input"
              type="password"
              value={connectSecret}
              onChange={(e) => setConnectSecret(e.target.value)}
              placeholder={t("oauth.client_secret_placeholder")}
              required
              autoComplete="off"
              autoFocus
            />
          </div>
        </FormModal>
      )}

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
          if (deletePresetTarget) removePreset.mutate((deletePresetTarget as OAuthPreset).service_type);
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
