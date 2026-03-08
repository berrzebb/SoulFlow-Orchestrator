import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { ChannelInstance, ModalMode } from "./types";
import { InstanceCard } from "./instance-card";
import { InstanceModal } from "./instance-modal";
import { GlobalSettingsSection } from "./global-settings";

export default function ChannelsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelInstance | null>(null);

  const { data: instances, isLoading } = useQuery<ChannelInstance[]>({
    queryKey: ["channel-instances"],
    queryFn: () => api.get("/api/channels/instances"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/channels/instances/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("channels.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["channel-instances"] }); },
    onError: (err) => toast(t("channels.remove_failed", { error: err.message }), "err"),
  });

  const toggle_enabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.put(`/api/channels/instances/${encodeURIComponent(id)}`, { enabled }),
    onMutate: ({ id, enabled }) => {
      // 이전 데이터를 롤백용으로 저장
      const prev = qc.getQueryData<ChannelInstance[]>(["channel-instances"]);
      // UI 즉시 업데이트
      if (prev) {
        qc.setQueryData(["channel-instances"], prev.map((inst) => inst.instance_id === id ? { ...inst, enabled } : inst));
      }
      return prev;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channel-instances"] }),
    onError: (err, _, prev) => {
      if (prev) qc.setQueryData(["channel-instances"], prev);
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
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
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
            <InstanceCard
              key={inst.instance_id}
              instance={inst}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
              onToggle={(enabled) => toggle_enabled.mutate({ id: inst.instance_id, enabled })}
            />
          ))}
        </div>
      )}

      {modal && (
        <InstanceModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["channel-instances"] });
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
