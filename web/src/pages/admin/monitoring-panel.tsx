import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useStatus } from "../../api/hooks";
import { Badge } from "../../components/badge";
import { SectionHeader } from "../../components/section-header";
import { api } from "../../api/client";
import { useT } from "../../i18n";
import { PROVIDER_COLORS } from "../../utils/constants";
import { fmt_time } from "../../utils/format";
import { MetricBar, StatusDot, fmt_uptime, fmt_kbps } from "../overview/helpers";
import { ProcessesSection } from "../overview/processes-section";
import type { DashboardState, SystemMetrics, ValidatorSummary } from "../overview/types";
import { PHASE_VARIANT } from "../overview/types";
import { SkeletonGrid } from "../../components/skeleton-grid";

export function MonitoringPanel() {
  const t = useT();
  const { data, refetch, isLoading } = useStatus();
  const s = data as DashboardState | undefined;
  const { data: metrics } = useQuery<SystemMetrics>({
    queryKey: ["system-metrics"],
    queryFn: () => api.get("/api/system/metrics"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  if (isLoading || !s) {
    return <SkeletonGrid count={4} className="stat-grid" />;
  }

  const active_processes = s.processes?.active ?? [];
  const recent_processes = s.processes?.recent ?? [];
  const running_jobs = s.cron?.jobs?.filter((j) => j.state?.running).length ?? 0;
  const enabled_jobs = s.cron?.jobs?.filter((j) => j.enabled).length ?? 0;
  const total_jobs = s.cron?.jobs?.length ?? 0;
  const next_job = s.cron?.jobs
    ?.filter((j) => j.enabled && j.state?.next_run_at_ms)
    .sort((a, b) => (a.state?.next_run_at_ms ?? 0) - (b.state?.next_run_at_ms ?? 0))[0];
  const providers = s.agent_providers ?? [];
  const available_providers = providers.filter((p) => p.enabled && p.available);
  const enabled_channels = s.channels?.enabled ?? [];

  return (
    <div className="overview fade-in">
      {/* Queue + CD Score */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card__header">
            <div className="stat-card__icon stat-card__icon--accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
          </div>
          <div className="stat-card__value">{(s.queue?.inbound ?? 0) + (s.queue?.outbound ?? 0)}</div>
          <div className="stat-card__label">{t("overview.queue")}</div>
          <div className="stat-card__extra">{t("overview.queue_fmt", { inbound: s.queue?.inbound ?? 0, outbound: s.queue?.outbound ?? 0 })}</div>
        </div>

        {s.cd_score && (
          <div className="stat-card">
            <div className="stat-card__header">
              <div className="stat-card__icon stat-card__icon--ok">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
            </div>
            <div className="stat-card__value">{s.cd_score.total}</div>
            <div className="stat-card__label">{t("overview.cd_score")}</div>
          </div>
        )}
      </div>

      {/* LLM Providers + Channels */}
      <div className="panel-grid">
        <section className="panel panel--flush">
          <SectionHeader title={`LLM ${t("nav.providers")}`}>
            <Link to="/providers" className="btn btn--xs">{t("common.view_all")}</Link>
          </SectionHeader>
          {providers.length === 0 ? (
            <p className="empty text-xs">{t("common.none")}</p>
          ) : (
            <div className="grid-stack">
              {providers.slice(0, 4).map((p) => (
                <div key={p.instance_id} className="overview-row">
                  <StatusDot ok={p.available} />
                  <span className="overview-row__name">{p.label || p.instance_id}</span>
                  <span className="text-xs text-muted">{p.provider_type}</span>
                  {p.circuit_state !== "closed" && <Badge status={p.circuit_state} variant="warn" />}
                </div>
              ))}
              {providers.length > 4 && <div className="text-xs text-muted">{t("overview.more_fmt", { count: providers.length - 4 })}</div>}
              <div className="section-divider">
                {available_providers.length}/{providers.length} {t("providers.available")}
              </div>
            </div>
          )}
        </section>

        <section className="panel panel--flush">
          <SectionHeader title={t("overview.channels")}>
            <Link to="/channels" className="btn btn--xs">{t("common.view_all")}</Link>
          </SectionHeader>
          {enabled_channels.length === 0 ? (
            <p className="empty text-xs">{t("common.none")}</p>
          ) : (
            <div className="grid-stack">
              {enabled_channels.map((ch) => {
                const health = s.channels?.health?.[ch];
                return (
                  <div key={ch} className="overview-row">
                    <span className="channel-dot" style={{ "--dot-c": PROVIDER_COLORS[ch] ?? "var(--accent)" } as React.CSSProperties} />
                    <span className="overview-row__name">{ch}</span>
                    {health != null ? (
                      <Badge status={health.running ? t("channels.running") : health.healthy ? "ready" : "stopped"} variant={health.running ? "ok" : health.healthy ? "info" : "err"} />
                    ) : (
                      <Badge status={t("common.enabled")} variant="ok" />
                    )}
                  </div>
                );
              })}
              {s.channels?.mention_loop_running && (
                <div className="text-xs text-ok mt-2">↺ {t("overview.mention_loop")}</div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Processes */}
      <ProcessesSection
        active={active_processes}
        recent={recent_processes}
        onCancelled={() => void refetch()}
      />

      {/* Cron */}
      <div className="panel-grid panel-grid--wider">
        {s.cron && (enabled_jobs > 0 || running_jobs > 0) && (
          <section className="panel panel--flush">
            <SectionHeader title={t("overview.cron")}>
              <Link to="/workspace" className="btn btn--xs">{t("common.view_all")}</Link>
            </SectionHeader>
            <div className="grid-stack">
              <div className="kv mt-0 mb-0">
                <Badge status={s.cron.paused ? t("overview.paused") : t("overview.active")} variant={s.cron.paused ? "warn" : "ok"} />
                <span className="text-sm text-muted">{t("overview.enabled_fmt", { enabled: enabled_jobs, total: total_jobs })}</span>
                {running_jobs > 0 && <Badge status={t("overview.running_fmt", { count: running_jobs })} variant="ok" />}
              </div>
              <div className="text-xs text-muted">
                {t("overview.next_wake")} <b>{fmt_time(s.cron.next_wake_at_ms)}</b>
                {next_job && <> · {t("overview.next_job")} <b>{next_job.name}</b></>}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Workflow events + Decisions */}
      <div className="panel-grid panel-grid--wider">
        <section className="panel panel--flush">
          <h2>{t("overview.workflow_events", { count: s.workflow_events?.length ?? 0 })}</h2>
          <ul className="list list--compact">
            {!s.workflow_events?.length && <li className="empty">-</li>}
            {s.workflow_events?.slice(0, 6).map((e) => (
              <li key={e.event_id}>
                <span className="li-text li-flex">
                  <Badge status={e.phase} variant={PHASE_VARIANT[e.phase]} />
                  <span className="text-xs text-muted truncate event-id">{e.task_id || e.agent_id || "-"}</span>
                  <span className="truncate text-sm flex-fill">{e.summary || ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {(s.decisions?.length ?? 0) > 0 && (
          <section className="panel panel--flush">
            <SectionHeader title={t("overview.decisions", { count: s.decisions?.length ?? 0 })}>
              <Link to="/workspace" className="btn btn--xs">{t("common.view_all")}</Link>
            </SectionHeader>
            <ul className="list list--compact">
              {s.decisions?.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <span className="li-text li-flex">
                    <Badge status={`p${d.priority}`} variant="info" />
                    <span className="truncate text-sm"><b>{d.canonical_key}</b></span>
                    <span className="text-xs text-muted truncate">{String(d.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Performance monitoring */}
      {metrics && (metrics.cpu_percent !== undefined || metrics.net_rx_kbps !== null) && (
        <div className="panel-grid">
          <section className="panel panel--flush">
            <SectionHeader title={t("overview.perf_monitoring")}>
              {metrics.uptime_s > 0 && (
                <span className="text-xs text-muted">{t("overview.uptime")} {fmt_uptime(metrics.uptime_s)}</span>
              )}
            </SectionHeader>
            <div className="grid-stack grid-stack--lg">
              <MetricBar
                label="CPU"
                percent={metrics.cpu_percent}
                used={metrics.cpu_percent}
                total={100}
                unit="%"
                color={metrics.cpu_percent >= 80 ? "var(--err)" : metrics.cpu_percent >= 60 ? "var(--warn)" : "var(--accent)"}
              />
              <MetricBar
                label="Memory"
                percent={metrics.mem_percent}
                used={metrics.mem_used_mb}
                total={metrics.mem_total_mb}
                color={metrics.mem_percent >= 85 ? "var(--err)" : metrics.mem_percent >= 70 ? "var(--warn)" : "var(--ok)"}
              />
              {metrics.swap_total_mb !== null && metrics.swap_total_mb > 0 && (
                <MetricBar
                  label="Swap"
                  percent={metrics.swap_percent ?? 0}
                  used={metrics.swap_used_mb ?? 0}
                  total={metrics.swap_total_mb}
                  color="var(--warn)"
                />
              )}
            </div>
          </section>

          {(metrics.net_rx_kbps !== null || metrics.net_tx_kbps !== null) && (
            <section className="panel panel--flush">
              <h2>{t("overview.net_monitoring")}</h2>
              <div className="grid-stack grid-stack--lg">
                {metrics.net_rx_kbps !== null && (
                  <div className="net-row">
                    <span className="text-xs text-muted">↓ {t("overview.net_rx")}</span>
                    <span className="fw-700 text-ok">{fmt_kbps(metrics.net_rx_kbps)}</span>
                  </div>
                )}
                {metrics.net_tx_kbps !== null && (
                  <div className="net-row">
                    <span className="text-xs text-muted">↑ {t("overview.net_tx")}</span>
                    <span className="fw-700 text-accent">{fmt_kbps(metrics.net_tx_kbps)}</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Validator Summary */}
      {s.validator_summary && (
        <ValidatorSummaryPanel summary={s.validator_summary} />
      )}

      <div className="overview__timestamp text-xs text-muted">{s.now || "-"}</div>
    </div>
  );
}

function ValidatorSummaryPanel({ summary }: { summary: ValidatorSummary }) {
  const t = useT();
  const variant = summary.failed_validators.length === 0
    ? (summary.total_validators === 0 ? "off" : "ok")
    : summary.failed_validators.length < summary.total_validators ? "warn" : "err";

  return (
    <section className="panel panel--flush">
      <SectionHeader title={t("overview.validator_summary") || "Validator Status"}>
        <span className="text-xs text-muted">{summary.repo_id}</span>
      </SectionHeader>
      <div className="grid-stack">
        <div className="kv mt-0 mb-0">
          <Badge
            status={
              summary.total_validators === 0
                ? (t("overview.validator_none") || "No validators")
                : summary.failed_validators.length === 0
                  ? (t("overview.validator_all_passed") || "All passed")
                  : (t("overview.validator_failed_fmt", { count: summary.failed_validators.length }) || `${summary.failed_validators.length} failed`)
            }
            variant={variant}
          />
          <span className="text-xs text-muted">
            {t("overview.validator_passed_fmt", {
              passed: summary.passed_validators,
              total: summary.total_validators,
            }) || `${summary.passed_validators}/${summary.total_validators} passed`}
          </span>
        </div>
        {summary.failed_validators.length > 0 && (
          <ul className="list list--compact">
            {summary.failed_validators.map((f, i) => (
              <li key={`${f.kind}-${i}`}>
                <span className="li-text li-flex">
                  <Badge status={f.kind} variant="err" />
                  <span className="text-xs text-muted truncate">{f.command}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {summary.artifact_bundle_id && (
          <div className="text-xs text-muted">
            Bundle: <code>{summary.artifact_bundle_id}</code>
          </div>
        )}
      </div>
    </section>
  );
}
