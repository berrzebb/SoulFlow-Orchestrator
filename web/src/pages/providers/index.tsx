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
import { ProviderModal } from "./provider-modal";
import { ConnectionModal } from "./connection-modal";
import { useAuthUser } from "../../hooks/use-auth";
import {
  useScopedProviders, useAddTeamProvider, useDeleteTeamProvider,
  useAddGlobalProvider, useDeleteGlobalProvider, type ScopedProvider, type ProviderInput,
} from "../../hooks/use-team-providers";

type Tab = "providers" | "chat" | "embedding" | "shared";

export default function ProvidersPage() {
  const { toast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<Tab>("providers");
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [connModal, setConnModal] = useState<ConnectionModalMode | null>(null);
  const { data: auth_user } = useAuthUser();

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
        {(["providers", "chat", "embedding", "shared"] as const).map((t_id) => (
          <button
            key={t_id}
            role="tab"
            aria-selected={tab === t_id}
            className={`provider-tab${tab === t_id ? " provider-tab--active" : ""}`}
            onClick={() => setTab(t_id)}
          >
            {t_id === "providers" ? t("providers.tab_providers") : t_id === "chat" ? t("providers.tab_chat") : t_id === "embedding" ? t("providers.tab_embedding") : "공유"}
            {t_id !== "shared" && (
              <span className="provider-tab__count">
                {t_id === "providers" ? connections.length : t_id === "chat" ? chatProviders.length : embedProviders.length}
              </span>
            )}
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

      {/* ── Tab: 공유 프로바이더 ── */}
      {tab === "shared" && (
        <SharedProvidersTab auth_user={auth_user ?? null} />
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

// ── 공유 프로바이더 탭 ─────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = { global: "전역", team: "팀", personal: "개인" };
const SCOPE_VARIANTS: Record<string, "info" | "warn" | "ok"> = { global: "info", team: "warn", personal: "ok" };

interface SharedProvidersTabProps {
  auth_user: { sub: string; role: "superadmin" | "user"; tid: string } | null;
}

function SharedProvidersTab({ auth_user }: SharedProvidersTabProps) {
  const { toast } = useToast();
  const team_id = auth_user?.tid ?? null;
  const is_superadmin = auth_user?.role === "superadmin";

  const { data: providers = [], isLoading } = useScopedProviders(team_id);
  const [deleteTarget, setDeleteTarget] = useState<ScopedProvider | null>(null);
  const [addForm, setAddForm] = useState<{ scope: "team" | "global"; open: boolean; name: string; type: string; model: string; api_key_ref: string }>({
    scope: "team", open: false, name: "", type: "", model: "", api_key_ref: "",
  });

  const add_team = useAddTeamProvider(team_id);
  const del_team = useDeleteTeamProvider(team_id);
  const add_global = useAddGlobalProvider();
  const del_global = useDeleteGlobalProvider();

  const open_add = (scope: "team" | "global") =>
    setAddForm({ scope, open: true, name: "", type: "", model: "", api_key_ref: "" });

  const submit_add = () => {
    const input: ProviderInput = {
      name: addForm.name.trim(), type: addForm.type.trim(),
      model: addForm.model.trim() || undefined,
      api_key_ref: addForm.api_key_ref.trim() || undefined,
      enabled: true,
    };
    const mut = addForm.scope === "global" ? add_global : add_team;
    mut.mutate(input, {
      onSuccess: () => {
        toast(`${SCOPE_LABELS[addForm.scope]} 프로바이더 추가 완료`, "ok");
        setAddForm((f) => ({ ...f, open: false }));
      },
      onError: (e: unknown) => {
        const msg = (e as { body?: { error?: string } })?.body?.error ?? "추가 실패";
        toast(msg, "err");
      },
    });
  };

  const do_delete = (p: ScopedProvider) => {
    if (p.scope === "global") {
      del_global.mutate(p.id, {
        onSuccess: () => toast("전역 프로바이더 삭제 완료", "ok"),
        onError: () => toast("삭제 실패", "err"),
      });
    } else {
      del_team.mutate(p.id, {
        onSuccess: () => toast("팀 프로바이더 삭제 완료", "ok"),
        onError: () => toast("삭제 실패", "err"),
      });
    }
    setDeleteTarget(null);
  };

  const can_delete = (p: ScopedProvider) =>
    p.scope === "global" ? is_superadmin : is_superadmin; // team scope: role check would need membership query

  return (
    <div className="fade-in">
      <SectionHeader title="공유 프로바이더">
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn btn--sm btn--accent" onClick={() => open_add("team")}>
            + 팀 프로바이더
          </button>
          {is_superadmin && (
            <button className="btn btn--sm btn--primary" onClick={() => open_add("global")}>
              + 전역 프로바이더
            </button>
          )}
        </div>
      </SectionHeader>
      <p className="text-sm text-muted mb-3">팀·전역 공유 프로바이더 목록. 범위 배지로 출처를 표시합니다.</p>

      {addForm.open && (
        <div className="panel panel--inset mb-3">
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <span className={`badge badge--${SCOPE_VARIANTS[addForm.scope]}`}>{SCOPE_LABELS[addForm.scope]}</span>
            <input className="form-input" style={{ flex: "1 1 100px" }} placeholder="이름 *" value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            <input className="form-input" style={{ flex: "1 1 100px" }} placeholder="타입 * (openai, anthropic...)" value={addForm.type}
              onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value }))} />
            <input className="form-input" style={{ flex: "1 1 120px" }} placeholder="모델" value={addForm.model}
              onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))} />
            <input className="form-input" style={{ flex: "1 1 120px" }} placeholder="API 키 참조" value={addForm.api_key_ref}
              onChange={(e) => setAddForm((f) => ({ ...f, api_key_ref: e.target.value }))} />
            <button className="btn btn--sm btn--ok" disabled={!addForm.name || !addForm.type || add_team.isPending || add_global.isPending}
              onClick={submit_add}>
              추가
            </button>
            <button className="btn btn--sm" onClick={() => setAddForm((f) => ({ ...f, open: false }))}>취소</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <SkeletonGrid count={2} />
      ) : !providers.length ? (
        <EmptyState title="공유 프로바이더가 없습니다" />
      ) : (
        <div className="stat-grid stat-grid--wide">
          {providers.map((p) => (
            <ResourceCard
              key={`${p.scope}-${p.id}`}
              resourceId={p.id}
              title={p.name}
              subtitle={p.type}
              statusVariant={p.enabled ? "ok" : "off"}
              statusLabel={p.enabled ? "활성" : "비활성"}
              badges={[
                { label: SCOPE_LABELS[p.scope] ?? p.scope, variant: SCOPE_VARIANTS[p.scope] ?? "info" },
                ...(p.model ? [{ label: p.model, variant: "info" as const }] : []),
              ]}
              {...(can_delete(p) ? { onRemove: () => setDeleteTarget(p) } : {})}
            >
              {p.api_key_ref && (
                <div className="stat-card__extra">
                  <span className="text-muted text-xs">키 참조: {p.api_key_ref}</span>
                </div>
              )}
              <div className="text-xs text-muted">{new Date(p.created_at).toLocaleDateString()}</div>
            </ResourceCard>
          ))}
        </div>
      )}

      <DeleteConfirmModal
        open={!!deleteTarget}
        title="프로바이더 삭제"
        message={`'${deleteTarget?.name}' (${SCOPE_LABELS[deleteTarget?.scope ?? ""]}) 프로바이더를 삭제하시겠습니까?`}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) do_delete(deleteTarget); }}
        confirmLabel="삭제"
      />
    </div>
  );
}
