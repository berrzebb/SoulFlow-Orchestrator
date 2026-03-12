/**
 * Prompting — Gallery 탭.
 * 빌트인·커스텀 에이전트 정의 목록 관리 (생성·편집·포크·삭제·채팅 이동).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useT } from "../../i18n";
import { useToast } from "../../components/toast";
import { SearchInput } from "../../components/search-input";
import { EmptyState } from "../../components/empty-state";
import { SkeletonGrid } from "../../components/skeleton-grid";
import { DeleteConfirmModal } from "../../components/modal";
import { AgentCard } from "./agent-card";
import { AgentModal, type AgentModalMode } from "./agent-modal";
import type { AgentDefinition } from "../../../../src/agent/agent-definition.types";

export function GalleryPanel() {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<AgentModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentDefinition | null>(null);

  const { data, isLoading } = useQuery<AgentDefinition[]>({
    queryKey: ["agent-definitions"],
    queryFn: () => api.get("/api/agent-definitions"),
    staleTime: 10_000,
  });

  const definitions = data ?? [];

  const filtered = search.trim()
    ? definitions.filter((d) =>
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.description.toLowerCase().includes(search.toLowerCase()) ||
        (d.role_skill ?? "").includes(search.toLowerCase()),
      )
    : definitions;

  const builtins = filtered.filter((d) => d.is_builtin);
  const customs = filtered.filter((d) => !d.is_builtin);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["agent-definitions"] });

  async function handle_fork(id: string) {
    try {
      await api.post(`/api/agent-definitions/${id}/fork`, {});
      toast(t("agents.forked"), "ok");
      refresh();
    } catch {
      toast(t("agents.fork_failed"), "err");
    }
  }

  async function handle_delete() {
    if (!deleteTarget) return;
    try {
      await api.del(`/api/agent-definitions/${deleteTarget.id}`);
      toast(t("agents.deleted"), "ok");
      setDeleteTarget(null);
      refresh();
    } catch {
      toast(t("agents.delete_failed"), "err");
    }
  }

  function handle_use(definition: AgentDefinition) {
    navigate("/chat", { state: { agent_definition: definition } });
  }

  return (
    <div className="ps-gallery">
      <div className="ps-gallery__toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("agents.search_placeholder")}
        />
        <button className="btn btn--sm btn--accent" onClick={() => setModal({ kind: "add" })}>
          + {t("agents.add")}
        </button>
      </div>

      {isLoading ? (
        <SkeletonGrid count={6} />
      ) : definitions.length === 0 ? (
        <EmptyState title={t("agents.no_definitions")} />
      ) : (
        <>
          {builtins.length > 0 && (
            <section className="provider-section">
              <h2 className="provider-section__title">{t("agents.builtin_section")} ({builtins.length})</h2>
              <div className="stat-grid stat-grid--wide fade-in">
                {builtins.map((def) => (
                  <AgentCard
                    key={def.id}
                    definition={def}
                    onFork={handle_fork}
                    onEdit={() => setModal({ kind: "edit", definition: def })}
                    onDelete={() => setDeleteTarget(def)}
                    onUse={handle_use}
                  />
                ))}
              </div>
            </section>
          )}

          {customs.length > 0 && (
            <section className="provider-section">
              <h2 className="provider-section__title">{t("agents.custom_section")} ({customs.length})</h2>
              <div className="stat-grid stat-grid--wide fade-in">
                {customs.map((def) => (
                  <AgentCard
                    key={def.id}
                    definition={def}
                    onFork={handle_fork}
                    onEdit={() => setModal({ kind: "edit", definition: def })}
                    onDelete={() => setDeleteTarget(def)}
                    onUse={handle_use}
                  />
                ))}
              </div>
            </section>
          )}

          {filtered.length === 0 && search && (
            <EmptyState title={t("agents.no_search_results", { query: search })} />
          )}
        </>
      )}

      {modal && (
        <AgentModal
          mode={modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}

      <DeleteConfirmModal
        open={!!deleteTarget}
        title={t("agents.delete_confirm_title")}
        message={t("agents.delete_confirm_desc", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handle_delete()}
      />
    </div>
  );
}
