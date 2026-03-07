import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { OAuthIntegration, OAuthPreset, ModalMode } from "./types";
import { OAuthCard } from "./oauth-card";
import { PresetCard } from "./preset-card";
import { OAuthModal } from "./oauth-modal";
import { PresetModal } from "./preset-modal";

export default function OAuthPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [presetModal, setPresetModal] = useState<OAuthPreset | null | "add">(null);
  const [deleteTarget, setDeleteTarget] = useState<OAuthIntegration | null>(null);
  const [deletePresetTarget, setDeletePresetTarget] = useState<OAuthPreset | null>(null);

  const { data: integrations, isLoading } = useQuery<OAuthIntegration[]>({
    queryKey: ["oauth-integrations"],
    queryFn: () => api.get("/api/oauth/integrations"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: presets = [] } = useQuery<OAuthPreset[]>({
    queryKey: ["oauth-presets"],
    queryFn: () => api.get("/api/oauth/presets"),
    staleTime: 60_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/oauth/integrations/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("oauth.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["oauth-integrations"] }); },
    onError: (err) => toast(t("oauth.remove_failed", { error: err.message }), "err"),
  });

  const removePreset = useMutation({
    mutationFn: (type: string) => api.del(`/api/oauth/presets/${encodeURIComponent(type)}`),
    onSuccess: () => { toast(t("oauth.preset_removed"), "ok"); void qc.invalidateQueries({ queryKey: ["oauth-presets"] }); },
    onError: (err) => toast(t("oauth.preset_remove_failed", { error: err.message }), "err"),
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
        <div className="empty-state"><div className="empty-state__icon">🔗</div><div className="empty-state__text">{t("oauth.no_integrations")}</div></div>
      ) : (
        <div className="stat-grid stat-grid--wide">
          {integrations.map((inst) => (
            <OAuthCard
              key={inst.instance_id}
              instance={inst}
              presets={presets}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
            />
          ))}
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
          <PresetCard key={p.service_type} preset={p} onEdit={() => setPresetModal(p)} onRemove={null} />
        ))}
        {custom_presets.map((p) => (
          <PresetCard
            key={p.service_type}
            preset={p}
            onEdit={() => setPresetModal(p)}
            onRemove={() => setDeletePresetTarget(p)}
          />
        ))}
        {custom_presets.length === 0 && builtin_presets.length === presets.filter((p) => p.service_type !== "custom").length && (
          <div className="empty-state empty-state--span-all"><div className="empty-state__icon">🔧</div><div className="empty-state__text">{t("oauth.no_custom_presets")}</div></div>
        )}
      </div>

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
          if (deletePresetTarget) removePreset.mutate(deletePresetTarget.service_type);
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
