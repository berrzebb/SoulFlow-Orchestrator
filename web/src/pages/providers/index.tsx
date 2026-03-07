import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { ProviderInstance, ModalMode } from "./types";
import { ProviderCard } from "./provider-card";
import { CliAuthSection } from "./cli-auth-section";
import { ProviderModal } from "./provider-modal";

type PurposeFilter = "all" | "chat" | "embedding";

export default function ProvidersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderInstance | null>(null);
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilter>("all");

  const { data: instances, isLoading } = useQuery<ProviderInstance[]>({
    queryKey: ["agent-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const { chatProviders, embedProviders, filtered } = useMemo(() => {
    if (!instances) return { chatProviders: [], embedProviders: [], filtered: [] };
    const chat = instances.filter((i) => (i.model_purpose || "chat") === "chat");
    const embed = instances.filter((i) => i.model_purpose === "embedding");
    const list = purposeFilter === "all" ? instances
      : purposeFilter === "chat" ? chat : embed;
    return { chatProviders: chat, embedProviders: embed, filtered: list };
  }, [instances, purposeFilter]);

  const counts = useMemo(() => ({
    all: (instances?.length) || 0,
    chat: chatProviders.length,
    embedding: embedProviders.length,
  }), [instances, chatProviders, embedProviders]);

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/agents/providers/${encodeURIComponent(id)}`),
    onSuccess: () => { toast(t("providers.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["agent-providers"] }); },
    onError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
  });

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("providers.title")}</h2>
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          {t("providers.add")}
        </button>
      </div>

      <div className="filter-tabs">
        {(["all", "chat", "embedding"] as const).map((f) => (
          <button
            key={f}
            className={`filter-tab${purposeFilter === f ? " filter-tab--active" : ""}`}
            onClick={() => setPurposeFilter(f)}
          >
            {f === "all" ? t("common.all") : f === "chat" ? t("providers.purpose_chat") : t("providers.purpose_embedding")}
            <span className="filter-tab__count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="stat-grid stat-grid--wide">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : !filtered.length ? (
        <div className="empty-state">
          <div className="empty-state__icon">🔌</div>
          <div className="empty-state__text">{t("providers.no_instances")}</div>
        </div>
      ) : purposeFilter === "all" ? (
        <div className="fade-in">
          {chatProviders.length > 0 && (
            <section className="provider-section">
              <h3 className="provider-section__title">{t("providers.purpose_chat")} <span className="text-muted">({chatProviders.length})</span></h3>
              <div className="stat-grid stat-grid--wide">
                {chatProviders.map((inst) => (
                  <ProviderCard key={inst.instance_id} instance={inst} onEdit={() => setModal({ kind: "edit", instance: inst })} onRemove={() => setDeleteTarget(inst)} />
                ))}
              </div>
            </section>
          )}
          {embedProviders.length > 0 && (
            <section className="provider-section">
              <h3 className="provider-section__title">{t("providers.purpose_embedding")} <span className="text-muted">({embedProviders.length})</span></h3>
              <div className="stat-grid stat-grid--wide">
                {embedProviders.map((inst) => (
                  <ProviderCard key={inst.instance_id} instance={inst} onEdit={() => setModal({ kind: "edit", instance: inst })} onRemove={() => setDeleteTarget(inst)} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="stat-grid stat-grid--wide fade-in">
          {filtered.map((inst) => (
            <ProviderCard
              key={inst.instance_id}
              instance={inst}
              onEdit={() => setModal({ kind: "edit", instance: inst })}
              onRemove={() => setDeleteTarget(inst)}
            />
          ))}
        </div>
      )}

      <CliAuthSection />

      <Modal
        open={!!deleteTarget}
        title={t("providers.remove_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.instance_id);
          setDeleteTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("providers.remove_confirm", { label: deleteTarget?.label || deleteTarget?.instance_id || "" })}
        </p>
      </Modal>

      {modal && (
        <ProviderModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["agent-providers"] });
          }}
        />
      )}
    </div>
  );
}
