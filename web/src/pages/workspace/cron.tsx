import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { fmt_time, fmt_schedule } from "../../utils/format";

interface CronStatus { paused: boolean; next_wake_at_ms: number }
interface CronJob {
  id: string; name: string; enabled: boolean;
  schedule: { kind: string; every_ms?: number; expr?: string; at_ms?: number };
  state?: { running?: boolean; next_run_at_ms?: number; last_status?: string; last_error?: string };
  delete_after_run?: boolean;
}

export function CronTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: status } = useQuery<CronStatus>({ queryKey: ["cron-status"], queryFn: () => api.get("/api/cron/status"), refetchInterval: 5000 });
  const { data: jobs = [] } = useQuery<CronJob[]>({ queryKey: ["cron-jobs"], queryFn: () => api.get("/api/cron/jobs?include_disabled=1"), refetchInterval: 5000 });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["cron-status"] });
    void qc.invalidateQueries({ queryKey: ["cron-jobs"] });
  };

  const toggle = async (id: string, enabled: boolean) => { await api.post(`/api/cron/jobs/${id}/enable`, { enabled }); refresh(); };
  const run = async (id: string) => { await api.post(`/api/cron/jobs/${id}/run`, { force: true }); toast(t("cron.job_triggered"), "ok"); refresh(); };
  const confirm_remove = async () => {
    if (!deleteTarget) return;
    await api.del(`/api/cron/jobs/${deleteTarget.id}`);
    toast(t("cron.job_removed"), "ok");
    setDeleteTarget(null);
    refresh();
  };
  const pause = async () => { await api.post("/api/cron/pause"); toast(t("cron.paused"), "warn"); refresh(); };
  const resume = async () => { await api.post("/api/cron/resume"); toast(t("cron.resumed"), "ok"); refresh(); };

  return (
    <>
      <Modal
        open={!!deleteTarget}
        title={t("cron.remove_title")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirm_remove()}
        confirmLabel={t("common.remove")}
        danger
      >
        <p style={{ fontSize: 12 }}>{t("cron.remove_confirm", { name: deleteTarget?.name ?? "" })}</p>
      </Modal>

      <div className="section-header">
        <h2>{t("cron.title", { count: jobs.length })}</h2>
        <div className="cron-controls">
          {status?.paused ? (
            <button className="btn btn--sm btn--ok" onClick={() => void resume()}>{t("cron.resume")}</button>
          ) : (
            <button className="btn btn--sm btn--warn" onClick={() => void pause()}>{t("cron.pause")}</button>
          )}
        </div>
      </div>

      <div className="kv" style={{ marginBottom: 12 }}>
        <div>
          {t("cron.status_label")} <Badge status={status?.paused ? t("overview.paused") : t("overview.active")} variant={status?.paused ? "warn" : "ok"} />
          {" · "}{t("cron.next_wake")} {fmt_time(status?.next_wake_at_ms)}
        </div>
      </div>

      {!jobs.length ? (
        <p className="empty">{t("cron.no_jobs")}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("cron.schedule")}</th>
                <th>{t("common.enabled")}</th>
                <th>{t("cron.next_run")}</th>
                <th>{t("cron.last_status")}</th>
                <th>{t("cron.one_shot")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <b>{j.name}</b>
                    <br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{j.id.slice(0, 12)}</span>
                  </td>
                  <td>{fmt_schedule(j.schedule)}</td>
                  <td>
                    <span
                      className={`toggle ${j.enabled ? "toggle--on" : "toggle--off"}`}
                      onClick={() => void toggle(j.id, !j.enabled)}
                    >
                      {j.enabled ? t("cron.on") : t("cron.off")}
                    </span>
                  </td>
                  <td>{fmt_time(j.state?.next_run_at_ms)}</td>
                  <td>
                    {j.state?.last_status ? <Badge status={j.state.last_status} /> : "-"}
                    {j.state?.last_error && (
                      <span style={{ color: "var(--err)", fontSize: 10, display: "block" }}>{j.state.last_error.slice(0, 60)}</span>
                    )}
                  </td>
                  <td>{j.delete_after_run ? <Badge status={t("cron.once")} variant="info" /> : "-"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn--xs btn--ok" disabled={j.state?.running} onClick={() => void run(j.id)}>{t("cron.run")}</button>
                      <button className="btn btn--xs btn--danger" onClick={() => setDeleteTarget({ id: j.id, name: j.name })}>{t("cron.del")}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
