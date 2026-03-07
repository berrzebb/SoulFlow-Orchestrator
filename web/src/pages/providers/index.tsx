import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { ProviderInstance, ProviderConnection, ModalMode, ConnectionModalMode } from "./types";
import { ProviderCard } from "./provider-card";
import { ConnectionCard } from "./connection-card";
import { CliAuthSection } from "./cli-auth-section";
import { ProviderModal } from "./provider-modal";
import { ConnectionModal } from "./connection-modal";

type Tab = "providers" | "chat" | "embedding";

export default function ProvidersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<Tab>("providers");
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [connModal, setConnModal] = useState<ConnectionModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderInstance | null>(null);
  const [deleteConnTarget, setDeleteConnTarget] = useState<ProviderConnection | null>(null);

  const { data: connections = [], isLoading: connLoading } = useQuery<ProviderConnection[]>({
    queryKey: ["agent-connections"],
    queryFn: () => api.get("/api/agents/connections"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: instances, isLoading } = useQuery<ProviderInstance[]>({
    queryKey: ["agent-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const chatProviders = instances?.filter((i) => (i.model_purpose || "chat") === "chat") ?? [];
  const embedProviders = instances?.filter((i) => i.model_purpose === "embedding") ?? [];

  const removeConn = useMutation({
    mutationFn: (id: string) => api.del(`/api/agents/connections/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast(t("connections.removed"), "ok");
      void qc.invalidateQueries({ queryKey: ["agent-connections"] });
      void qc.invalidateQueries({ queryKey: ["agent-providers"] });
    },
    onError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/agents/providers/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast(t("providers.removed"), "ok");
      void qc.invalidateQueries({ queryKey: ["agent-providers"] });
      void qc.invalidateQueries({ queryKey: ["agent-connections"] });
    },
    onError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
  });

  const openAddModal = () => {
    const purpose = tab === "embedding" ? "embedding" : "chat";
    setModal({ kind: "add", defaultPurpose: purpose });
  };

  return (
    <div className="page">
      {/* Tab bar */}
      <div className="provider-tabs" role="tablist">
        {(["providers", "chat", "embedding"] as const).map((t_id) => (
          <button
            key={t_id}
            role="tab"
            aria-selected={tab === t_id}
            className={`provider-tab${tab === t_id ? " provider-tab--active" : ""}`}
            onClick={() => setTab(t_id)}
          >
            {t_id === "providers" ? t("providers.tab_providers") : t_id === "chat" ? t("providers.tab_chat") : t("providers.tab_embedding")}
            <span className="provider-tab__count">
              {t_id === "providers" ? connections.length : t_id === "chat" ? chatProviders.length : embedProviders.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── Tab: 프로바이더 ── */}
      {tab === "providers" && (
        <div className="fade-in">
          <div className="section-header">
            <h2>{t("connections.title")}</h2>
            <button className="btn btn--sm btn--accent" onClick={() => setConnModal({ kind: "add" })}>
              {t("connections.add")}
            </button>
          </div>
          <p className="text-sm text-muted mb-3">{t("connections.description")}</p>

          {connLoading ? (
            <div className="stat-grid stat-grid--wide">
              <div className="skeleton skeleton-card" />
            </div>
          ) : !connections.length ? (
            <div className="empty-state empty-state--sm">
              <div className="empty-state__text">{t("connections.no_connections")}</div>
            </div>
          ) : (
            <div className="stat-grid stat-grid--wide">
              {connections.map((conn) => (
                <ConnectionCard
                  key={conn.connection_id}
                  connection={conn}
                  onEdit={() => setConnModal({ kind: "edit", connection: conn })}
                  onRemove={() => setDeleteConnTarget(conn)}
                />
              ))}
            </div>
          )}

          <CliAuthSection />
        </div>
      )}

      {/* ── Tab: Chat ── */}
      {tab === "chat" && (
        <div className="fade-in">
          <div className="section-header">
            <h2>{t("providers.tab_chat")}</h2>
            <button className="btn btn--sm btn--accent" onClick={openAddModal}>
              {t("providers.add")}
            </button>
          </div>
          <p className="text-sm text-muted mb-3">{t("providers.chat_description")}</p>

          {isLoading ? (
            <div className="stat-grid stat-grid--wide">
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
            </div>
          ) : !chatProviders.length ? (
            <div className="empty-state">
              <div className="empty-state__icon">💬</div>
              <div className="empty-state__text">{t("providers.no_chat_models")}</div>
            </div>
          ) : (
            <div className="stat-grid stat-grid--wide">
              {chatProviders.map((inst) => (
                <ProviderCard
                  key={inst.instance_id}
                  instance={inst}
                  onEdit={() => setModal({ kind: "edit", instance: inst })}
                  onRemove={() => setDeleteTarget(inst)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Embedding ── */}
      {tab === "embedding" && (
        <div className="fade-in">
          <div className="section-header">
            <h2>{t("providers.tab_embedding")}</h2>
            <button className="btn btn--sm btn--accent" onClick={openAddModal}>
              {t("providers.add")}
            </button>
          </div>
          <p className="text-sm text-muted mb-3">{t("providers.embedding_description")}</p>

          {isLoading ? (
            <div className="stat-grid stat-grid--wide">
              <div className="skeleton skeleton-card" />
            </div>
          ) : !embedProviders.length ? (
            <div className="empty-state">
              <div className="empty-state__icon">📐</div>
              <div className="empty-state__text">{t("providers.no_embed_models")}</div>
            </div>
          ) : (
            <div className="stat-grid stat-grid--wide">
              {embedProviders.map((inst) => (
                <ProviderCard
                  key={inst.instance_id}
                  instance={inst}
                  onEdit={() => setModal({ kind: "edit", instance: inst })}
                  onRemove={() => setDeleteTarget(inst)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
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

      <Modal
        open={!!deleteConnTarget}
        title={t("connections.remove_title")}
        onClose={() => setDeleteConnTarget(null)}
        onConfirm={() => {
          if (deleteConnTarget) removeConn.mutate(deleteConnTarget.connection_id);
          setDeleteConnTarget(null);
        }}
        confirmLabel={t("common.remove")}
        danger
      >
        <p className="text-sm">
          {t("connections.remove_confirm", { label: deleteConnTarget?.label || deleteConnTarget?.connection_id || "" })}
        </p>
      </Modal>

      {modal && (
        <ProviderModal
          mode={modal}
          connections={connections}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void qc.invalidateQueries({ queryKey: ["agent-providers"] });
            void qc.invalidateQueries({ queryKey: ["agent-connections"] });
          }}
        />
      )}

      {connModal && (
        <ConnectionModal
          mode={connModal}
          onClose={() => setConnModal(null)}
          onSaved={() => {
            setConnModal(null);
            void qc.invalidateQueries({ queryKey: ["agent-connections"] });
          }}
        />
      )}
    </div>
  );
}
