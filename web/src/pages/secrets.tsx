import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToast } from "../components/toast";
import { useState } from "react";
import { useT } from "../i18n";
import { Modal } from "../components/modal";

export default function SecretsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<{ names: string[] }>({ queryKey: ["secrets"], queryFn: () => api.get("/api/secrets"), refetchInterval: 10_000 });
  const names = data?.names ?? [];

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["secrets"] });

  const add = async () => {
    if (!newName.trim()) return;
    await api.post("/api/secrets", { name: newName, value: newValue });
    toast(t("secrets.saved"), "ok");
    setAdding(false);
    setNewName("");
    setNewValue("");
    refresh();
  };

  const confirm_remove = async () => {
    if (!deleteTarget) return;
    await api.del(`/api/secrets/${encodeURIComponent(deleteTarget)}`);
    toast(t("secrets.removed"), "ok");
    setDeleteTarget(null);
    refresh();
  };

  return (
    <div className="page">
      <div className="section-header">
        <h2>{t("secrets.title", { count: names.length })}</h2>
        <button className="btn btn--sm btn--ok" onClick={() => setAdding(true)}>{t("secrets.add")}</button>
      </div>

      {!names.length ? (
        <p className="empty">{t("secrets.no_secrets")}</p>
      ) : (
        <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>{t("common.name")}</th><th>{t("secrets.usage")}</th><th>{t("common.actions")}</th></tr></thead>
          <tbody>
            {names.map((name) => (
              <tr key={name}>
                <td><b>{name}</b></td>
                <td style={{ fontSize: 11, color: "var(--muted)" }}>{`{{secret:${name}}}`}</td>
                <td>
                  <button className="btn btn--xs" onClick={() => { setNewName(name); setNewValue(""); setAdding(true); }}>{t("secrets.update")}</button>{" "}
                  <button className="btn btn--xs btn--danger" onClick={() => setDeleteTarget(name)}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <Modal
        open={!!deleteTarget}
        title={t("secrets.delete_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirm_remove()}
        confirmLabel={t("common.delete")}
        danger
      >
        <p style={{ fontSize: 12 }}>{t("secrets.delete_confirm", { name: deleteTarget ?? "" })}</p>
      </Modal>

      <Modal
        open={adding}
        title={newName && names.includes(newName) ? t("secrets.update_title") : t("secrets.add_title")}
        onClose={() => { setAdding(false); setNewName(""); setNewValue(""); }}
        onConfirm={() => void add()}
        confirmLabel={t("common.save")}
      >
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("common.name")}</label>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("secrets.name_placeholder")}
          style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", padding: 6, fontFamily: "inherit", fontSize: 12, marginBottom: 10 }}
        />
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("secrets.value")}</label>
        <input
          type="password"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={t("secrets.value_placeholder")}
          style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", padding: 6, fontFamily: "inherit", fontSize: 12 }}
        />
      </Modal>
    </div>
  );
}
