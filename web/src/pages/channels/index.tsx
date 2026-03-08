import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Modal } from "../../components/modal";
import { ResourceCard } from "../../components/resource-card";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { useResourceCRUD } from "../../hooks/use-resource-crud";
import { time_ago } from "../../utils/format";
import type { ChannelInstance, ModalMode } from "./types";
import { InstanceModal } from "./instance-modal";
import { GlobalSettingsSection } from "./global-settings";

export default function ChannelsPage() {
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);

  const { items: instances, isLoading, deleteTarget, setDeleteTarget, remove, queryClient } = useResourceCRUD<ChannelInstance>({
    queryKey: ["channel-instances"],
    queryFn: () => api.get("/api/channels/instances"),
    deleteEndpoint: (id) => `/api/channels/instances/${encodeURIComponent(id)}`,
    onDeleteSuccess: () => toast(t("channels.removed"), "ok"),
    onDeleteError: (err) => toast(t("channels.remove_failed", { error: err.message }), "err"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const toggle_enabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/api/channels/instances/${encodeURIComponent(id)}`, { enabled }),
    onMutate: ({ id, enabled }) => {
      const prev = queryClient.getQueryData<ChannelInstance[]>(["channel-instances"]);
      if (prev) {
        queryClient.setQueryData(["channel-instances"], prev.map((inst) => inst.instance_id === id ? { ...inst, enabled } : inst));
      }
      return prev;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["channel-instances"] }),
    onError: (err, _, prev) => {
      if (prev) queryClient.setQueryData(["channel-instances"], prev);
      toast(t("channels.save_failed", { error: err.message }), "err");
    },
  });

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("channels.title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          {t("channels.add")}
        </button>
      </div>

      <GlobalSettingsSection />

      {isLoading ? (
        <div className="stat-grid stat-grid--wide mt-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : !instances?.length ? (
        <div className="empty-state">
          <div className="empty-state__icon">📡</div>
          <div className="empty-state__text">{t("channels.no_instances")}</div>
          <button className="btn btn--sm btn--accent empty-state__action" onClick={() => setModal({ kind: "add" })}>{t("channels.add")}</button>
        </div>
      ) : (
        <div className="stat-grid stat-grid--wide fade-in mt-3">
          {instances.map((inst) => (
            <ResourceCard
              key={inst.instance_id}
              resourceId={inst.instance_id}
              title={inst.label || inst.instance_id}
              subtitle={inst.instance_id}
              statusVariant={inst.running ? "ok" : "off"}
              statusLabel={inst.enabled ? t("channels.running") : t("common.disabled")}
              badges={[
                { label: inst.provider.toUpperCase(), variant: "info" },
                ...(inst.running ? [] : [{ label: t("common.disconnected"), variant: "err" }] as const),
              ]}
              testUrl={`/api/channels/instances/${encodeURIComponent(inst.instance_id)}/test`}
              onTestSuccess={() => `${inst.label}: ${t("channels.connected")}`}
              onTestFail={(err) => `${inst.label}: ${err}`}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
            >
              <div className="stat-card__header">
                <ToggleSwitch
                  checked={inst.enabled}
                  onChange={(enabled) => toggle_enabled.mutate({ id: inst.instance_id, enabled })}
                  aria-label={t("common.enabled")}
                />
              </div>
              {inst.default_target && (
                <div className="stat-card__extra">
                  <span className="text-xs text-muted">{inst.default_target}</span>
                </div>
              )}
              {inst.last_error && (
                <div className="text-xs text-err mt-1">{inst.last_error}</div>
              )}
              {inst.updated_at && (
                <div className="text-xs text-muted">{time_ago(inst.updated_at)}</div>
              )}
            </ResourceCard>
          ))}
        </div>
      )}

      {modal && (
        <InstanceModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void queryClient.invalidateQueries({ queryKey: ["channel-instances"] });
          }}
        />
      )}

      <Modal
        open={!!deleteTarget}
        title={t("channels.remove_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.instance_id);
          setDeleteTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("channels.remove_confirm", { label: deleteTarget?.label || deleteTarget?.instance_id || "" })}
        </p>
      </Modal>
    </div>
  );
}
