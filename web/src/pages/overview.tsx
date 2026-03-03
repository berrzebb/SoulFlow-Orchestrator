import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useStatus } from "../api/hooks";
import { Badge } from "../components/badge";
import { api } from "../api/client";
import { classify_agent } from "../utils/classify";
import { fmt_time } from "../utils/format";
import { useT } from "../i18n";

interface SystemMetrics {
  cpu_percent: number;
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;
  swap_total_mb: number | null;
  swap_used_mb: number | null;
  swap_percent: number | null;
  net_rx_kbps: number | null;
  net_tx_kbps: number | null;
  uptime_s: number;
}

function fmt_uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmt_kbps(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${kbps} KB/s`;
}

function MetricBar({ label, percent, used, total, unit = "MB", color = "var(--accent)" }: {
  label: string; percent: number; used: number; total: number; unit?: string; color?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{used.toLocaleString()} / {total.toLocaleString()} {unit} <span style={{ color: "var(--muted)" }}>({percent}%)</span></span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--panel-elevated)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(percent, 100)}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

interface AgentInfo {
  id: string; label: string; role: string; model: string;
  status: string; last_message: string;
}
interface ProcessInfo {
  run_id: string; alias: string; mode: string; status: string;
  provider?: string; executor_provider?: string;
  tool_calls_count: number; error?: string;
  started_at?: string; ended_at?: string;
}
interface TaskInfo {
  taskId: string; title: string; status: string;
  currentTurn: number; maxTurns: number;
}
interface CronJob {
  id: string; name: string; enabled: boolean;
  schedule: { kind: string; every_ms?: number; expr?: string; at_ms?: number };
  state?: { running?: boolean; next_run_at_ms?: number; last_status?: string; last_error?: string };
}
interface MessageInfo { sender_id: string; content: string; direction: string }
interface DecisionInfo { id: string; canonical_key: string; value: unknown; priority: number }
interface WorkflowEvent { event_id: string; phase: string; task_id: string; agent_id: string; summary: string }
interface AgentProvider {
  instance_id: string; provider_type: string; label: string;
  enabled: boolean; available: boolean; circuit_state: string;
  token_configured: boolean;
}

interface DashboardState {
  now: string;
  queue: { inbound: number; outbound: number };
  channels: {
    enabled: string[];
    mention_loop_running: boolean;
    health?: Record<string, { healthy: boolean; running: boolean }>;
  };
  agents: AgentInfo[];
  processes: { active: ProcessInfo[]; recent: ProcessInfo[] };
  tasks: TaskInfo[];
  cron: { paused: boolean; jobs: CronJob[]; next_wake_at_ms: number } | null;
  messages: MessageInfo[];
  decisions: DecisionInfo[];
  workflow_events: WorkflowEvent[];
  cd_score: { total: number } | null;
  agent_providers?: AgentProvider[];
}

const ACTIVE_TASK_STATUSES = new Set(["running", "waiting_approval", "waiting_user_input"]);

const MODE_STYLE: Record<string, { color: string; bg: string }> = {
  once:  { color: "var(--muted)",   bg: "rgba(145,164,183,0.1)" },
  agent: { color: "var(--accent)",  bg: "rgba(74,158,255,0.1)" },
  task:  { color: "var(--ok)",      bg: "rgba(47,177,113,0.1)" },
};

const PHASE_VARIANT: Record<string, "ok" | "warn" | "err" | "info" | undefined> = {
  done: "ok", start: "info", error: "err", fail: "err", warn: "warn",
};

const PROVIDER_COLORS: Record<string, string> = {
  slack: "#36C5F0", discord: "#5865F2", telegram: "#2AABEE",
};

function ModeBadge({ mode }: { mode: string }) {
  const s = MODE_STYLE[mode] ?? { color: "var(--muted)", bg: "rgba(145,164,183,0.1)" };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, padding: "1px 6px", borderRadius: 4, border: `1px solid ${s.color}`, letterSpacing: "0.04em" }}>
      {mode.toUpperCase()}
    </span>
  );
}

function PulseDot({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--ok)", flexShrink: 0, animation: "pulse-fade 1.5s ease-in-out infinite" }} />
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ok ? "var(--ok)" : "var(--err)", flexShrink: 0 }} />
  );
}

export default function OverviewPage() {
  const t = useT();
  const { data, refetch, isLoading } = useStatus();
  const s = data as DashboardState | undefined;
  const [showRecentProc, setShowRecentProc] = useState(false);
  const { data: metrics } = useQuery<SystemMetrics>({
    queryKey: ["system-metrics"],
    queryFn: () => api.get("/api/system-metrics"),
    refetchInterval: 3000,
    staleTime: 2000,
  });

  const cancel_process = (id: string) => void api.post(`/api/processes/${id}/cancel`).then(() => refetch());

  if (isLoading || !s) {
    return (
      <div className="stat-grid">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton skeleton-card" />)}
      </div>
    );
  }

  const working_agents = s.agents?.filter((a) => classify_agent(a.status) === "working").length ?? 0;
  const active_tasks = s.tasks?.filter((tk) => ACTIVE_TASK_STATUSES.has(tk.status)).length ?? 0;
  const active_processes = s.processes?.active ?? [];
  const recent_processes = s.processes?.recent ?? [];
  const running_jobs = s.cron?.jobs?.filter((j) => j.state?.running).length ?? 0;
  const enabled_jobs = s.cron?.jobs?.filter((j) => j.enabled).length ?? 0;
  const total_jobs = s.cron?.jobs?.length ?? 0;
  const next_job = s.cron?.jobs
    ?.filter((j) => j.enabled && j.state?.next_run_at_ms)
    .sort((a, b) => (a.state!.next_run_at_ms ?? 0) - (b.state!.next_run_at_ms ?? 0))[0];
  const providers = s.agent_providers ?? [];
  const available_providers = providers.filter((p) => p.enabled && p.available);
  const enabled_channels = s.channels?.enabled ?? [];

  return (
    <div className="overview">
      {/* ── 1행: 시스템 상태 카드 — Channels/Processes는 아래 섹션에서 표시 ── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card__header">
            <div className="stat-card__icon stat-card__icon--accent">↕</div>
          </div>
          <div className="stat-card__value">{(s.queue?.inbound ?? 0) + (s.queue?.outbound ?? 0)}</div>
          <div className="stat-card__label">{t("overview.queue")}</div>
          <div className="stat-card__extra">{t("overview.queue_fmt", { inbound: s.queue?.inbound ?? 0, outbound: s.queue?.outbound ?? 0 })}</div>
        </div>

        <Link to="/workspace">
          <div className="stat-card">
            <div className="stat-card__header">
              <div className="stat-card__icon stat-card__icon--accent">☰</div>
              {active_tasks > 0 && <Badge status={t("overview.active_fmt", { count: active_tasks })} variant="ok" />}
            </div>
            <div className="stat-card__value">{s.tasks?.length ?? 0}</div>
            <div className="stat-card__label">{t("overview.tasks")}</div>
          </div>
        </Link>

        {(s.agents?.length ?? 0) > 0 && (
          <Link to="/workspace">
            <div className="stat-card">
              <div className="stat-card__header">
                <div className="stat-card__icon stat-card__icon--warn">●</div>
                {working_agents > 0 && <Badge status={t("overview.working_fmt", { count: working_agents })} variant="warn" />}
              </div>
              <div className="stat-card__value">{s.agents?.length ?? 0}</div>
              <div className="stat-card__label">{t("overview.agents")}</div>
            </div>
          </Link>
        )}

        {s.cd_score && (
          <div className="stat-card">
            <div className="stat-card__header">
              <div className="stat-card__icon stat-card__icon--ok">◆</div>
            </div>
            <div className="stat-card__value">{s.cd_score.total}</div>
            <div className="stat-card__label">{t("overview.cd_score")}</div>
          </div>
        )}
      </div>

      {/* ── 2행: LLM 프로바이더 + 메시지 채널 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--sp-3)" }}>
        <section className="panel" style={{ margin: 0 }}>
          <div className="section-header" style={{ marginBottom: 10 }}>
            <h2>LLM {t("nav.providers")}</h2>
            <Link to="/providers" className="btn btn--xs">{t("common.view_all")}</Link>
          </div>
          {providers.length === 0 ? (
            <p className="empty" style={{ fontSize: 12 }}>{t("common.none")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {providers.slice(0, 4).map((p) => (
                <div key={p.instance_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <StatusDot ok={p.available} />
                  <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.label || p.instance_id}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>{p.provider_type}</span>
                  {p.circuit_state !== "closed" && <Badge status={p.circuit_state} variant="warn" />}
                </div>
              ))}
              {providers.length > 4 && <div style={{ fontSize: 11, color: "var(--muted)" }}>+{providers.length - 4} more</div>}
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 6, fontSize: 11, color: "var(--muted)" }}>
                {available_providers.length}/{providers.length} {t("providers.available")}
              </div>
            </div>
          )}
        </section>

        <section className="panel" style={{ margin: 0 }}>
          <div className="section-header" style={{ marginBottom: 10 }}>
            <h2>{t("overview.channels")}</h2>
            <Link to="/channels" className="btn btn--xs">{t("common.view_all")}</Link>
          </div>
          {enabled_channels.length === 0 ? (
            <p className="empty" style={{ fontSize: 12 }}>{t("common.none")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {enabled_channels.map((ch) => {
                const health = s.channels?.health?.[ch];
                return (
                  <div key={ch} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: PROVIDER_COLORS[ch] ?? "var(--accent)", display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, flex: 1, textTransform: "capitalize" }}>{ch}</span>
                    {health != null ? (
                      <Badge status={health.running ? t("channels.running") : health.healthy ? "ready" : "stopped"} variant={health.running ? "ok" : health.healthy ? "info" : "err"} />
                    ) : (
                      <Badge status={t("common.enabled")} variant="ok" />
                    )}
                  </div>
                );
              })}
              {s.channels?.mention_loop_running && (
                <div style={{ fontSize: 11, color: "var(--ok)", marginTop: 4 }}>↺ mention loop running</div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── 3행: 프로세스 ── */}
      <section className="panel">
        <div className="section-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {t("overview.processes")}
            {active_processes.length > 0 && <Badge status={t("overview.processes_active_fmt", { count: active_processes.length })} variant="warn" />}
          </h2>
          <Link to="/workspace" className="btn btn--xs">{t("common.view_all")}</Link>
        </div>

        {active_processes.length === 0 ? (
          <p className="empty">{t("overview.no_active_processes")}</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {active_processes.map((p) => (
              <div key={p.run_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--panel-elevated)", borderRadius: 6, border: "1px solid var(--line)" }}>
                <PulseDot active={p.status === "running"} />
                <ModeBadge mode={p.mode} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{p.alias}</span>
                {p.provider && <span className="text-xs text-muted">{p.provider}</span>}
                {p.executor_provider && <span className="text-xs" style={{ color: "var(--accent)" }}>{p.executor_provider}</span>}
                <span className="text-xs text-muted" style={{ marginLeft: "auto" }}>{t("overview.tool_prefix")}{p.tool_calls_count}</span>
                {p.started_at && <span className="text-xs text-muted">{fmt_time(new Date(p.started_at).getTime())}</span>}
                <button className="btn btn--xs btn--danger" onClick={() => cancel_process(p.run_id)}>{t("common.cancel")}</button>
              </div>
            ))}
          </div>
        )}

        {recent_processes.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn--xs"
              onClick={() => setShowRecentProc((v) => !v)}
              style={{ color: "var(--muted)", background: "none", border: "none", padding: "2px 0" }}
            >
              {showRecentProc ? "▾" : "▸"} {t("overview.recent_processes")} ({recent_processes.length})
            </button>
            {showRecentProc && (
              <div style={{ display: "grid", gap: 4, marginTop: 6, opacity: 0.65 }}>
                {recent_processes.slice(0, 8).map((p) => (
                  <div key={p.run_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "var(--panel-elevated)", borderRadius: 6, border: "1px solid var(--line)", fontSize: 12 }}>
                    <Badge status={p.status} />
                    <ModeBadge mode={p.mode} />
                    <span>{p.alias}</span>
                    {p.executor_provider && <span className="text-muted">{p.executor_provider}</span>}
                    <span className="text-muted" style={{ marginLeft: "auto" }}>{t("overview.tool_prefix")}{p.tool_calls_count}</span>
                    {p.error && <span style={{ color: "var(--err)", fontSize: 11 }}>⚠ {p.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 4행: 크론(잡 있을 때) + 메시지 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--sp-3)" }}>
        {s.cron && (enabled_jobs > 0 || running_jobs > 0) && (
          <section className="panel" style={{ margin: 0 }}>
            <div className="section-header">
              <h2>{t("overview.cron")}</h2>
              <Link to="/workspace" className="btn btn--xs">{t("common.view_all")}</Link>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="kv" style={{ margin: 0 }}>
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

        <section className="panel" style={{ margin: 0 }}>
          <h2>{t("overview.messages")}</h2>
          <ul className="list list--compact">
            {!s.messages?.length && <li className="empty">-</li>}
            {s.messages?.map((m, i) => (
              <li key={i}>
                <span className="li-text" style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ color: m.direction === "inbound" ? "var(--accent)" : "var(--muted)", fontWeight: 600, flexShrink: 0, fontSize: 11 }}>
                    {m.direction === "inbound" ? t("overview.msg_in") : t("overview.msg_out")} {m.sender_id}
                  </span>
                  <span className="truncate text-sm text-muted">{m.content}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── 5행: 워크플로우 이벤트 + 결정사항 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--sp-3)" }}>
        <section className="panel" style={{ margin: 0 }}>
          <h2>{t("overview.workflow_events", { count: s.workflow_events?.length ?? 0 })}</h2>
          <ul className="list list--compact">
            {!s.workflow_events?.length && <li className="empty">-</li>}
            {s.workflow_events?.slice(0, 6).map((e) => (
              <li key={e.event_id}>
                <span className="li-text" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Badge status={e.phase} variant={PHASE_VARIANT[e.phase]} />
                  <span className="text-xs text-muted truncate">{e.task_id || e.agent_id || "-"}</span>
                  <span className="truncate text-sm">{e.summary || ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {(s.decisions?.length ?? 0) > 0 && (
          <section className="panel" style={{ margin: 0 }}>
            <div className="section-header">
              <h2>{t("overview.decisions", { count: s.decisions?.length ?? 0 })}</h2>
              <Link to="/workspace" className="btn btn--xs">{t("common.view_all")}</Link>
            </div>
            <ul className="list list--compact">
              {s.decisions?.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <span className="li-text" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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

      {/* ── 6행: 성능 + 네트워크 모니터링 ── */}
      {metrics && (metrics.cpu_percent !== undefined || metrics.net_rx_kbps !== null) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--sp-3)" }}>
          <section className="panel" style={{ margin: 0 }}>
            <div className="section-header" style={{ marginBottom: 12 }}>
              <h2>{t("overview.perf_monitoring")}</h2>
              {metrics.uptime_s > 0 && (
                <span className="text-xs text-muted">{t("overview.uptime")} {fmt_uptime(metrics.uptime_s)}</span>
              )}
            </div>
            <div style={{ display: "grid", gap: 12 }}>
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
            <section className="panel" style={{ margin: 0 }}>
              <h2 style={{ marginBottom: 14 }}>{t("overview.net_monitoring")}</h2>
              <div style={{ display: "grid", gap: 12 }}>
                {metrics.net_rx_kbps !== null && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>↓ {t("overview.net_rx")}</span>
                    <span style={{ fontWeight: 700, color: "var(--ok)" }}>{fmt_kbps(metrics.net_rx_kbps)}</span>
                  </div>
                )}
                {metrics.net_tx_kbps !== null && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>↑ {t("overview.net_tx")}</span>
                    <span style={{ fontWeight: 700, color: "var(--accent)" }}>{fmt_kbps(metrics.net_tx_kbps)}</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <div className="text-xs text-muted" style={{ textAlign: "right", paddingTop: 4 }}>{s.now || "-"}</div>
    </div>
  );
}
