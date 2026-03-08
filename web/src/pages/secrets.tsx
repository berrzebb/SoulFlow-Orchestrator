import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { EmptyState } from "../components/empty-state";
import { useToast } from "../components/toast";
import { SearchInput } from "../components/search-input";
import { SectionHeader } from "../components/section-header";
import { useState } from "react";
import { useT } from "../i18n";
import { Modal, DeleteConfirmModal } from "../components/modal";
import { FormGroup } from "../components/form-group";

export default function SecretsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ names: string[] }>({ queryKey: ["secrets"], queryFn: () => api.get("/api/secrets"), refetchInterval: 30_000, staleTime: 10_000 });
  const names = data?.names ?? [];

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = names.filter((n) => !search || n.toLowerCase().includes(search.toLowerCase()));

  const copy_usage = (name: string) => {
    navigator.clipboard.writeText(`{{secret:${name}}}`)
      .then(() => toast(t("secrets.copied"), "ok"))
      .catch(() => toast(t("secrets.copy_failed"), "err"));
  };

  const refresh = () => void qc.invalidateQueries({ queryKey: ["secrets"] });

  const add = async () => {
    if (!newName.trim()) return;
    try {
      await api.post("/api/secrets", { name: newName, value: newValue });
      toast(t("secrets.saved"), "ok");
      setAdding(false);
      setNewName("");
      setNewValue("");
      refresh();
    } catch {
      toast(t("secrets.save_failed"), "err");
    }
  };

  const confirm_remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.del(`/api/secrets/${encodeURIComponent(deleteTarget)}`);
      toast(t("secrets.removed"), "ok");
      setDeleteTarget(null);
      refresh();
    } catch {
      toast(t("secrets.remove_failed"), "err");
    }
  };

  return (
    <div className="page">
      <SectionHeader title={t("secrets.title", { count: names.length })}>
        <div className="section-header__actions">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t("secrets.search")}
            onClear={() => setSearch("")}
            autoFocus
            className="section-header__search"
          />
          <button className="btn btn--sm btn--ok" onClick={() => setAdding(true)}>{t("secrets.add")}</button>
        </div>
      </SectionHeader>

      {!names.length ? (
        <EmptyState icon="🔐" title={t("secrets.no_secrets")}
          actions={<button className="btn btn--sm btn--ok" onClick={() => setAdding(true)}>{t("secrets.add")}</button>}
        />
      ) : !filtered.length ? (
        <EmptyState type="no-results" title={t("secrets.no_match")} />
      ) : (
        <>
          <div className="table-scroll secret-table-view">
            <table className="data-table">
              <thead><tr><th>{t("common.name")}</th><th>{t("secrets.usage")}</th><th>{t("common.actions")}</th></tr></thead>
              <tbody>
                {filtered.map((name) => (
                  <tr key={name}>
                    <td><b>{name}</b></td>
                    <td className="text-xs text-muted break-all">
                      <code>{`{{secret:${name}}}`}</code>
                      <button className="btn btn--xs ml-1" onClick={() => copy_usage(name)} title={t("secrets.copy_usage")}>
                        {t("common.copy")}
                      </button>
                    </td>
                    <td>
                      <button className="btn btn--xs" onClick={() => { setNewName(name); setNewValue(""); setAdding(true); }}>{t("secrets.update")}</button>{" "}
                      <button className="btn btn--xs btn--danger" onClick={() => setDeleteTarget(name)}>{t("common.delete")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="secret-card-list">
            {filtered.map((name) => (
              <div key={name} className="secret-card">
                <div className="secret-card__name">{name}</div>
                <code className="secret-card__usage">{`{{secret:${name}}}`}</code>
                <div className="secret-card__actions">
                  <button className="btn btn--xs" onClick={() => copy_usage(name)}>{t("common.copy")}</button>
                  <button className="btn btn--xs" onClick={() => { setNewName(name); setNewValue(""); setAdding(true); }}>{t("secrets.update")}</button>
                  <button className="btn btn--xs btn--danger" onClick={() => setDeleteTarget(name)}>{t("common.delete")}</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <DeleteConfirmModal
        open={!!deleteTarget}
        title={t("secrets.delete_title")}
        message={t("secrets.delete_confirm", { name: deleteTarget ?? "" })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirm_remove()}
        confirmLabel={t("common.delete")}
      />

      <Modal
        open={adding}
        title={newName && names.includes(newName) ? t("secrets.update_title") : t("secrets.add_title")}
        onClose={() => { setAdding(false); setNewName(""); setNewValue(""); }}
        onConfirm={() => void add()}
        confirmLabel={t("common.save")}
      >
        <FormGroup label={t("common.name")}>
          <input
            autoFocus
            className="form-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={newName && names.includes(newName)}
            placeholder={t("secrets.name_placeholder")}
          />
        </FormGroup>
        <FormGroup label={t("secrets.value")}>
          <input
            className="form-input"
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) void add(); }}
            placeholder={t("secrets.value_placeholder")}
          />
        </FormGroup>
      </Modal>
    </div>
  );
}
