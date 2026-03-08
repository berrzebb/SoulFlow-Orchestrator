import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { DeleteConfirmModal } from "../../components/modal";
import { SectionHeader } from "../../components/section-header";
import { useToast } from "../../components/toast";
import { api } from "../../api/client";
import { time_ago } from "../../utils/format";
import { useT } from "../../i18n";
import { ModeBadge, PulseDot } from "./helpers";
import type { ProcessInfo } from "./types";

interface ProcessesSectionProps {
  active: ProcessInfo[];
  recent: ProcessInfo[];
  onCancelled: () => void;
}

export function ProcessesSection({ active, recent, onCancelled }: ProcessesSectionProps) {
  const t = useT();
  const { toast } = useToast();
  const [showRecent, setShowRecent] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  const cancel_process = (id: string) => {
    if (cancellingIds.has(id)) return;
    setCancellingIds((prev) => new Set(prev).add(id));
    void api.del(`/api/processes/${encodeURIComponent(id)}`)
      .then(() => onCancelled())
      .catch(() => toast(t("overview.cancel_failed"), "err"))
      .finally(() => setCancellingIds((prev) => { const next = new Set(prev); next.delete(id); return next; }));
  };

  return (
    <section className="panel">
      <SectionHeader titleClassName="li-flex" title={<>
        {t("overview.processes")}
        {active.length > 0 && <Badge status={t("overview.processes_active_fmt", { count: active.length })} variant="warn" />}
      </>}>
        <Link to="/workspace" className="btn btn--xs">{t("common.view_all")}</Link>
      </SectionHeader>

      {active.length === 0 ? (
        <EmptyState title={t("overview.no_active_processes")} />
      ) : (
        <div className="grid-stack">
          {active.map((p) => (
            <div key={p.run_id} className="process-row">
              <PulseDot active={p.status === "running"} />
              <ModeBadge mode={p.mode} />
              <span className="settings-row__label truncate flex-fill">{p.alias}</span>
              {p.provider && <span className="text-xs text-muted">{p.provider}</span>}
              {p.executor_provider && <span className="text-xs text-accent">{p.executor_provider}</span>}
              <span className="text-xs text-muted ml-auto">{t("overview.tool_prefix")}{p.tool_calls_count}</span>
              {p.started_at && <span className="text-xs text-muted" title={p.started_at}>{time_ago(p.started_at)}</span>}
              <button className="btn btn--xs btn--danger" disabled={cancellingIds.has(p.run_id)} onClick={() => setCancelConfirmId(p.run_id)}>{t("common.cancel")}</button>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-2">
          <button
            className="toggle-btn text-muted"
            aria-expanded={showRecent}
            onClick={() => setShowRecent((v) => !v)}
          >
            {showRecent ? "▾" : "▸"} {t("overview.recent_processes")} ({recent.length})
          </button>
          {showRecent && (
            <div className="grid-stack mt-2">
              {recent.slice(0, 8).map((p) => (
                <div key={p.run_id} className="process-row process-row--recent">
                  <Badge status={p.status} />
                  <ModeBadge mode={p.mode} />
                  <span className="truncate flex-fill">{p.alias}</span>
                  {p.executor_provider && <span className="text-muted">{p.executor_provider}</span>}
                  <span className="text-muted ml-auto">{t("overview.tool_prefix")}{p.tool_calls_count}</span>
                  {p.ended_at && <span className="text-xs text-muted" title={p.ended_at}>{time_ago(p.ended_at)}</span>}
                  {p.error && <span className="text-err text-xs truncate proc-error" title={p.error}>⚠ {p.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DeleteConfirmModal
        open={!!cancelConfirmId}
        title={t("overview.cancel_process_title")}
        message={t("overview.cancel_process_confirm")}
        onClose={() => setCancelConfirmId(null)}
        onConfirm={() => { if (cancelConfirmId) cancel_process(cancelConfirmId); setCancelConfirmId(null); }}
        confirmLabel={t("common.cancel")}
      />
    </section>
  );
}
