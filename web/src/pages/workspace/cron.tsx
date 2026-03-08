import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { DeleteConfirmModal } from "../../components/modal";
import { SectionHeader } from "../../components/section-header";
import { ToggleSwitch } from "../../components/toggle-switch";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { fmt_time, fmt_schedule, time_ago } from "../../utils/format";

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
  const { data: status } = useQuery<CronStatus>({ queryKey: ["cron-status"], queryFn: () => api.get("/api/cron/status"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: jobs = [] } = useQuery<CronJob[]>({ queryKey: ["cron-jobs"], queryFn: () => api.get("/api/cron/jobs?include_disabled=1"), refetchInterval: 15_000, staleTime: 5_000 });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["cron-status"] });
    void qc.invalidateQueries({ queryKey: ["cron-jobs"] });
  };

  const toggle = async (id: string, enabled: boolean) => {
    try { await api.put(`/api/cron/jobs/${encodeURIComponent(id)}`, { enabled }); refresh(); }
    catch { toast(t("cron.toggle_failed"), "err"); }
  };
  const run = async (id: string) => {
    try { await api.post(`/api/cron/jobs/${encodeURIComponent(id)}/runs`, { force: true }); toast(t("cron.job_triggered"), "ok"); refresh(); }
    catch { toast(t("cron.run_failed"), "err"); }
  };
  const confirm_remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.del(`/api/cron/jobs/${encodeURIComponent(deleteTarget.id)}`);
      toast(t("cron.job_removed"), "ok");
      setDeleteTarget(null);
      refresh();
    } catch { toast(t("cron.remove_failed"), "err"); }
  };
  const pause = async () => {
    try { await api.put("/api/cron/status", { paused: true }); toast(t("cron.paused"), "warn"); refresh(); }
    catch { toast(t("cron.pause_failed"), "err"); }
  };
  const resume = async () => {
    try { await api.put("/api/cron/status", { paused: false }); toast(t("cron.resumed"), "ok"); refresh(); }
    catch { toast(t("cron.resume_failed"), "err"); }
  };

  return (
    <>
      <DeleteConfirmModal
        open={!!deleteTarget}
        title={t("cron.remove_title")}
        message={t("cron.remove_confirm", { name: deleteTarget?.name ?? "" })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirm_remove()}
        confirmLabel={t("common.remove")}
      />

      <SectionHeader title={t("cron.title", { count: jobs.length })}>
        <div className="cron-controls">
          {status?.paused ? (
            <button className="btn btn--sm btn--ok" onClick={() => void resume()}>{t("cron.resume")}</button>
          ) : (
            <button className="btn btn--sm btn--warn" onClick={() => void pause()}>{t("cron.pause")}</button>
          )}
        </div>
      </SectionHeader>

      <div className="kv mb-2">
        <div>
          {t("cron.status_label")} <Badge status={status?.paused ? t("overview.paused") : t("overview.active")} variant={status?.paused ? "warn" : "ok"} />
          {" · "}{t("cron.next_wake")} {fmt_time(status?.next_wake_at_ms)}
        </div>
      </div>

      {!jobs.length ? (
        <EmptyState icon="⏰" title={t("cron.no_jobs")} />
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
                    <div className="li-flex">
                      {j.state?.running && <span className="cron-running-dot" title={t("cron.currently_running")} />}
                      <b>{j.name}</b>
                    </div>
                    <span className="text-xs text-muted">{j.id.slice(0, 12)}</span>
                  </td>
                  <td>{fmt_schedule(j.schedule)}</td>
                  <td>
                    <ToggleSwitch
                      checked={j.enabled}
                      onChange={(v) => void toggle(j.id, v)}
                      aria-label={t("common.enabled")}
                    />
                  </td>
                  <td title={j.state?.next_run_at_ms ? time_ago(j.state.next_run_at_ms) : ""}>{fmt_time(j.state?.next_run_at_ms)}</td>
                  <td>
                    {j.state?.last_status ? <Badge status={j.state.last_status} /> : "-"}
                    {j.state?.last_error && (
                      <span className="text-xs text-err d-block">{j.state.last_error.slice(0, 60)}</span>
                    )}
                  </td>
                  <td>{j.delete_after_run ? <Badge status={t("cron.once")} variant="info" /> : "-"}</td>
                  <td>
                    <div className="li-flex">
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
