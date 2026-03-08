import { useState } from "react";
import { api } from "../../api/client";
import { EmptyState } from "../../components/empty-state";
import { DeleteConfirmModal } from "../../components/modal";
import { SkeletonGrid } from "../../components/skeleton-grid";
import { ResourceCard } from "../../components/resource-card";
import { SectionHeader } from "../../components/section-header";
import { useToast } from "../../components/toast";
import { useResourceCRUD } from "../../hooks/use-resource-crud";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";
import { PROVIDER_TYPE_LABELS as TYPE_LABELS } from "../../utils/constants";
import type { ProviderInstance, ProviderConnection, ModalMode, ConnectionModalMode } from "./types";
import { CliAuthSection } from "./cli-auth-section";
import { ProviderModal } from "./provider-modal";
import { ConnectionModal } from "./connection-modal";

type Tab = "providers" | "chat" | "embedding";

export default function ProvidersPage() {
  const { toast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<Tab>("providers");
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [connModal, setConnModal] = useState<ConnectionModalMode | null>(null);

  const { items: connections, isLoading: connLoading, deleteTarget: deleteConnTarget, setDeleteTarget: setDeleteConnTarget, remove: removeConn, queryClient: qc } =
    useResourceCRUD<ProviderConnection>({
      queryKey: ["agent-connections"],
      queryFn: () => api.get("/api/agents/connections"),
      deleteEndpoint: (id) => `/api/agents/connections/${encodeURIComponent(id)}`,
      onDeleteSuccess: () => { toast(t("connections.removed"), "ok"); void qc.invalidateQueries({ queryKey: ["agent-providers"] }); },
      onDeleteError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
      refetchInterval: 15_000,
      staleTime: 10_000,
    });

  const { items: instances, isLoading, deleteTarget, setDeleteTarget, remove, queryClient } = useResourceCRUD<ProviderInstance>({
    queryKey: ["agent-providers"],
    queryFn: () => api.get("/api/agents/providers"),
    deleteEndpoint: (id) => `/api/agents/providers/${encodeURIComponent(id)}`,
    onDeleteSuccess: () => { toast(t("providers.removed"), "ok"); void queryClient.invalidateQueries({ queryKey: ["agent-connections"] }); },
    onDeleteError: (err) => toast(t("providers.remove_failed", { error: err.message }), "err"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const chatProviders = instances?.filter((i) => (i.model_purpose || "chat") === "chat") ?? [];
  const embedProviders = instances?.filter((i) => i.model_purpose === "embedding") ?? [];

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
          <SectionHeader title={t("connections.title")}>
            <button className="btn btn--sm btn--accent" onClick={() => setConnModal({ kind: "add" })}>
              {t("connections.add")}
            </button>
          </SectionHeader>
          <p className="text-sm text-muted mb-3">{t("connections.description")}</p>

          {connLoading ? (
            <SkeletonGrid count={1} />
          ) : !connections.length ? (
            <EmptyState title={t("connections.no_connections")} className="empty-state--sm" />
          ) : (
            <div className="stat-grid stat-grid--wide">
              {connections.map((conn) => (
                <ResourceCard
                  key={conn.connection_id}
                  resourceId={conn.connection_id}
                  title={conn.label || conn.connection_id}
                  subtitle={conn.connection_id}
                  statusVariant={conn.enabled && conn.token_configured ? "ok" : conn.enabled ? "warn" : "off"}
                  statusLabel={conn.enabled ? t("providers.on") : t("providers.off")}
                  badges={[
                    { label: TYPE_LABELS[conn.provider_type] || conn.provider_type, variant: "info" },
                  ]}
                  testUrl={`/api/agents/connections/${encodeURIComponent(conn.connection_id)}/test`}
                  onTestSuccess={() => `${conn.label}: ${t("providers.available")}`}
                  onTestFail={(err) => `${conn.label}: ${err}`}
                  onEdit={() => setConnModal({ kind: "edit", connection: conn })}
                  onRemove={() => setDeleteConnTarget(conn)}
                >
                  <div className="stat-card__extra">
                    {conn.api_base && (
                      <>
                        <span className="text-accent">{conn.api_base}</span>
                        {" · "}
                      </>
                    )}
                    {conn.token_configured ? (
                      <span className="text-ok">{t("providers.token_configured")}</span>
                    ) : (
                      <span className="text-err">{t("providers.no_token")}</span>
                    )}
                    {" · "}
                    <span className="text-muted">{t("connections.preset_count", { count: String(conn.preset_count) })}</span>
                  </div>
                  {conn.updated_at && (
                    <div className="text-xs text-muted">{time_ago(conn.updated_at)}</div>
                  )}
                </ResourceCard>
              ))}
            </div>
          )}

          <CliAuthSection />
        </div>
      )}

      {/* ── Tab: Chat ── */}
      {tab === "chat" && (
        <div className="fade-in">
          <SectionHeader title={t("providers.tab_chat")}>
            <button className="btn btn--sm btn--accent" onClick={openAddModal}>
              {t("providers.add")}
            </button>
          </SectionHeader>
          <p className="text-sm text-muted mb-3">{t("providers.chat_description")}</p>

          {isLoading ? (
            <SkeletonGrid count={2} />
          ) : !chatProviders.length ? (
            <EmptyState icon="💬" title={t("providers.no_chat_models")} />
          ) : (
            <div className="stat-grid stat-grid--wide">
              {chatProviders.map((inst) => (
                <ResourceCard
                  key={inst.instance_id}
                  resourceId={inst.instance_id}
                  title={inst.label || inst.instance_id}
                  subtitle={inst.instance_id}
                  statusVariant={inst.available ? "ok" : inst.enabled ? "warn" : "off"}
                  statusLabel={inst.enabled ? t("providers.on") : t("common.disabled")}
                  badges={[
                    { label: TYPE_LABELS[inst.provider_type] || inst.provider_type, variant: "info" },
                    { label: inst.model_purpose || "chat", variant: "info" },
                    ...(inst.available ? [] : [{ label: t("common.unavailable"), variant: "err" }] as const),
                  ]}
                  testUrl={`/api/agents/providers/${encodeURIComponent(inst.instance_id)}/test`}
                  onTestSuccess={(d) => `${inst.label}: ${d || t("providers.available")}`}
                  onTestFail={(err) => `${inst.label}: ${err}`}
                  onEdit={() => setModal({ kind: "edit", instance: inst })}
                  onRemove={() => setDeleteTarget(inst)}
                >
                  <div className="stat-card__extra">
                    {!!inst.settings?.model && (
                      <>
                        <span className="text-accent">{String(inst.settings.model)}</span>
                        {" · "}
                      </>
                    )}
                    {inst.token_configured ? (
                      <span className="text-ok">{t("providers.token_configured")}</span>
                    ) : (
                      <span className="text-err">{t("providers.no_token")}</span>
                    )}
                    {" · "}
                    <span className="text-muted">{t("providers.priority")}: {inst.priority}</span>
                  </div>
                  {inst.supported_modes?.length > 0 && (
                    <div className="stat-card__tags">
                      {inst.supported_modes.map((m) => <span key={m} className="badge badge--info">{m}</span>)}
                    </div>
                  )}
                  {inst.updated_at && (
                    <div className="text-xs text-muted">{time_ago(inst.updated_at)}</div>
                  )}
                </ResourceCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Embedding ── */}
      {tab === "embedding" && (
        <div className="fade-in">
          <SectionHeader title={t("providers.tab_embedding")}>
            <button className="btn btn--sm btn--accent" onClick={openAddModal}>
              {t("providers.add")}
            </button>
          </SectionHeader>
          <p className="text-sm text-muted mb-3">{t("providers.embedding_description")}</p>

          {isLoading ? (
            <SkeletonGrid count={1} />
          ) : !embedProviders.length ? (
            <EmptyState icon="📐" title={t("providers.no_embed_models")} />
          ) : (
            <div className="stat-grid stat-grid--wide">
              {embedProviders.map((inst) => (
                <ResourceCard
                  key={inst.instance_id}
                  resourceId={inst.instance_id}
                  title={inst.label || inst.instance_id}
                  subtitle={inst.instance_id}
                  statusVariant={inst.available ? "ok" : inst.enabled ? "warn" : "off"}
                  statusLabel={inst.enabled ? t("providers.on") : t("common.disabled")}
                  badges={[
                    { label: TYPE_LABELS[inst.provider_type] || inst.provider_type, variant: "info" },
                    { label: "embedding", variant: "warn" },
                  ]}
                  testUrl={`/api/agents/providers/${encodeURIComponent(inst.instance_id)}/test`}
                  onTestSuccess={(d) => `${inst.label}: ${d || t("providers.available")}`}
                  onTestFail={(err) => `${inst.label}: ${err}`}
                  onEdit={() => setModal({ kind: "edit", instance: inst })}
                  onRemove={() => setDeleteTarget(inst)}
                >
                  <div className="stat-card__extra">
                    {!!inst.settings?.model && (
                      <>
                        <span className="text-accent">{String(inst.settings.model)}</span>
                        {" · "}
                      </>
                    )}
                    {inst.token_configured ? (
                      <span className="text-ok">{t("providers.token_configured")}</span>
                    ) : (
                      <span className="text-err">{t("providers.no_token")}</span>
                    )}
                  </div>
                  {inst.updated_at && (
                    <div className="text-xs text-muted">{time_ago(inst.updated_at)}</div>
                  )}
                </ResourceCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title={t("providers.remove_title")}
        message={t("providers.remove_confirm", { label: deleteTarget?.label || deleteTarget?.instance_id || "" })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) remove.mutate(deleteTarget.instance_id); setDeleteTarget(null); }}
        confirmLabel={t("common.remove")}
      />

      <DeleteConfirmModal
        open={!!deleteConnTarget}
        title={t("connections.remove_title")}
        message={t("connections.remove_confirm", { label: deleteConnTarget?.label || deleteConnTarget?.connection_id || "" })}
        onClose={() => setDeleteConnTarget(null)}
        onConfirm={() => { if (deleteConnTarget) removeConn.mutate(deleteConnTarget.connection_id); setDeleteConnTarget(null); }}
        confirmLabel={t("common.remove")}
      />

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
