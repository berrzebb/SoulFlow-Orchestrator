import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { SendAgentModal } from "../../components/send-agent-modal";
import { useToast } from "../../components/toast";
import { classify_agent } from "../../utils/classify";
import { fmt_time, time_ago } from "../../utils/format";
import { useT } from "../../i18n";

interface Agent {
  id: string; label: string; role: string; model: string; status: string;
  session_id?: string; created_at?: string; updated_at?: string;
  last_error?: string; last_message?: string;
}

interface AgentLoop {
  loopId: string; agentId: string; objective: string;
  currentTurn: number; maxTurns: number; status: string;
  channelId?: string; messageId?: string;
}

interface TaskLoop {
  taskId: string; title: string; status: string; currentStep?: string; exitReason?: string;
  currentTurn: number; maxTurns: number; objective: string;
  updatedAt?: string; channel?: string; chat_id?: string;
}

interface ProcessEntry {
  run_id: string; provider: string; chat_id: string; alias: string;
  sender_id: string; mode: string; status: string;
  started_at: string; ended_at?: string;
  subagent_ids: string[]; tool_calls_count: number;
  executor_provider?: string; error?: string;
}

const ACTIVE_STATUSES = new Set(["running", "waiting_approval", "waiting_user_input"]);
const WAITING_STATUSES = new Set(["waiting_approval", "waiting_user_input"]);

const STATUS_ICON: Record<string, string> = {
  running: "🔄", completed: "✅", failed: "❌", cancelled: "🚫",
  waiting_approval: "🔐", waiting_user_input: "💬", stopped: "⏹️", max_turns_reached: "⚠️",
};

function TurnBar({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return (
    <div className="turn-bar" title={`${current}/${max} (${pct}%)`} style={{ "--bar-w": `${pct}%` } as React.CSSProperties} role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={max}>
      <div className="turn-bar__fill" />
      <span className="turn-bar__label">{current}/{max}</span>
    </div>
  );
}

function ChannelRef({ channelId, messageId }: { channelId: string; messageId?: string }) {
  return (
    <span className="li-flex text-xs">
      <Badge status={channelId} variant="info" />
      {messageId && <span className="text-xs text-muted">#{messageId.slice(-6)}</span>}
    </span>
  );
}

export function AgentsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["agents"], queryFn: () => api.get("/api/agents"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: agent_loops = [] } = useQuery<AgentLoop[]>({ queryKey: ["loops"], queryFn: () => api.get("/api/loops"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: task_loops = [] } = useQuery<TaskLoop[]>({ queryKey: ["tasks"], queryFn: () => api.get("/api/tasks"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: processes_data } = useQuery<{ active: ProcessEntry[]; recent: ProcessEntry[] }>(
    { queryKey: ["processes"], queryFn: () => api.get("/api/processes"), refetchInterval: 15_000, staleTime: 5_000 }
  );

  const [sendTarget, setSendTarget] = useState<string | null>(null);
  const [resumeTarget, setResumeTarget] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState<{ kind: string; id: string; label: string } | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRecentProcesses, setShowRecentProcesses] = useState(false);
  const [completedSearch, setCompletedSearch] = useState("");
  const [completedStatusFilter, setCompletedStatusFilter] = useState("all");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["agents"] });
    void qc.invalidateQueries({ queryKey: ["loops"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["processes"] });
  };

  const active_tasks = task_loops.filter((tl) => ACTIVE_STATUSES.has(tl.status));
  const completed_tasks = task_loops.filter((tl) => !ACTIVE_STATUSES.has(tl.status));

  const active_processes = processes_data?.active ?? [];
  const recent_processes = processes_data?.recent ?? [];

  const safe_action = async (fn: () => Promise<void>, ok_msg: string, after?: () => void) => {
    try {
      await fn();
      toast(ok_msg, "ok");
      after?.();
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "err");
    }
  };

  const handle_send = (agentId: string, text: string) => void safe_action(() => api.post(`/api/agents/${encodeURIComponent(agentId)}/input`, { text }), t("agents.message_sent"), () => setSendTarget(null));

  const confirm_cancel = () => {
    if (!cancelConfirm) return;
    const { kind, id } = cancelConfirm;
    setCancelConfirm(null);
    if (kind === "agent") void safe_action(() => api.del(`/api/agents/${encodeURIComponent(id)}`), t("agents.cancelled"));
    else if (kind === "loop") void safe_action(() => api.del(`/api/loops/${encodeURIComponent(id)}`), t("agents.loop_stopped"));
    else if (kind === "task") void safe_action(() => api.del(`/api/tasks/${encodeURIComponent(id)}`), t("agents.task_cancelled"));
    else if (kind === "process") void safe_action(() => api.del(`/api/processes/${encodeURIComponent(id)}`), t("agents.process_cancelled"));
  };
  const confirm_resume = () => {
    if (!resumeTarget) return;
    void safe_action(
      () => api.put(`/api/tasks/${encodeURIComponent(resumeTarget)}`, { text: resumeText || undefined }),
      t("agents.task_resumed"),
      () => { setResumeTarget(null); setResumeText(""); },
    );
  };

  return (
    <>
      <SendAgentModal agentId={sendTarget} onClose={() => setSendTarget(null)} onSend={(id, text) => void handle_send(id, text)} />

      <Modal open={!!cancelConfirm} title={t("agents.cancel_confirm_title")} onClose={() => setCancelConfirm(null)} onConfirm={confirm_cancel} confirmLabel={t("common.confirm")} danger>
        <p className="text-sm">{t("agents.cancel_confirm_desc", { label: cancelConfirm?.label ?? "" })}</p>
      </Modal>

      <Modal open={!!resumeTarget} title={t("agents.resume_task")} onClose={() => { setResumeTarget(null); setResumeText(""); }} onConfirm={() => void confirm_resume()} confirmLabel={t("agents.resume")}>
        <label className="form-label">{t("agents.user_input")}</label>
        <textarea autoFocus className="form-input resize-y" value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={3} />
      </Modal>

      {/* 실행 프로세스 */}
      <div className="section-header">
        <h2 className="li-flex">
          <span className="section-header__icon">⚡</span>
          {t("agents.processes_title")}
          {active_processes.length > 0 && (
            <span className="section-header__badge">{t("agents.processes_active", { count: active_processes.length })}</span>
          )}
        </h2>
      </div>

      {!active_processes.length ? (
        <div className="empty-state"><div className="empty-state__icon">⚡</div><div className="empty-state__text">{t("agents.no_processes")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th><th>{t("agents.mode")}</th><th>{t("agents.provider")}</th>
                <th>{t("agents.executor")}</th><th>{t("agents.tools")}</th>
                <th>{t("agents.started")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {active_processes.map((p) => (
                <tr key={p.run_id}>
                  <td className="text-xs text-muted">{p.run_id}</td>
                  <td>
                    <span className={`mode-badge mode-badge--${p.mode}`}>
                      {p.mode}
                    </span>
                  </td>
                  <td className="text-sm">{p.provider}<br /><span className="text-xs text-muted">{p.alias}</span></td>
                  <td className="text-sm text-muted">{p.executor_provider || "-"}</td>
                  <td className="text-sm">{p.tool_calls_count}</td>
                  <td className="text-xs text-muted">{fmt_time(p.started_at)}</td>
                  <td><Badge status={p.status} /></td>
                  <td><button className="btn btn--xs btn--danger" onClick={() => setCancelConfirm({ kind: "process", id: p.run_id, label: p.alias })}>{t("agents.process_cancel")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recent_processes.length > 0 && (
        <div className="mt-2">
          <button className="btn btn--sm toggle-btn" aria-expanded={showRecentProcesses} onClick={() => setShowRecentProcesses((v) => !v)}>
            {showRecentProcesses ? t("agents.hide_recent") : t("agents.show_recent", { count: recent_processes.length })}
          </button>
          {showRecentProcesses && (
            <div className="table-scroll mt-2">
              <table className="data-table data-table--xs">
                <thead>
                  <tr><th>Run ID</th><th>{t("agents.mode")}</th><th>{t("agents.provider")}</th><th>{t("agents.executor")}</th><th>{t("agents.tools")}</th><th>{t("common.status")}</th><th>{t("agents.started")}</th><th>{t("agents.ended")}</th></tr>
                </thead>
                <tbody>
                  {recent_processes.map((p) => (
                    <tr key={p.run_id}>
                      <td className="text-xs text-muted">{p.run_id}</td>
                      <td><span className={`mode-badge mode-badge--${p.mode}`}>{p.mode}</span></td>
                      <td>{p.provider} / {p.alias}</td>
                      <td>{p.executor_provider || "-"}</td>
                      <td>{p.tool_calls_count}</td>
                      <td>{STATUS_ICON[p.status] || ""} <Badge status={p.status} />{p.error && <span className="text-xs text-err ml-1">⚠ {p.error}</span>}</td>
                      <td>{fmt_time(p.started_at)}</td>
                      <td>{p.ended_at ? fmt_time(p.ended_at) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Agent Loop */}
      <div className="section-header section-header--spaced">
        <h2 className="li-flex">
          <span className="section-header__icon">🔄</span>
          {t("agents.agent_loops", { count: agent_loops.length })}
        </h2>
      </div>
      {!agent_loops.length ? (
        <div className="empty-state"><div className="empty-state__icon">🔄</div><div className="empty-state__text">{t("agents.no_agent_loops")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>{t("agents.id")}</th><th>{t("agents.objective")}</th><th>{t("agents.turn")}</th><th>{t("agents.channel")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr>
            </thead>
            <tbody>
              {agent_loops.map((l) => (
                <tr key={l.loopId} className={WAITING_STATUSES.has(l.status) ? "row--waiting" : undefined}>
                  <td className="text-xs text-muted" title={l.loopId}>{l.loopId.slice(0, 12)}</td>
                  <td className="truncate td--wide">{l.objective || "-"}</td>
                  <td><TurnBar current={l.currentTurn} max={l.maxTurns} /></td>
                  <td>{l.channelId ? <ChannelRef channelId={l.channelId} messageId={l.messageId} /> : <span className="text-muted">-</span>}</td>
                  <td><Badge status={l.status} /></td>
                  <td><button className="btn btn--xs btn--danger" onClick={() => setCancelConfirm({ kind: "loop", id: l.loopId, label: l.loopId.slice(0, 12) })}>{t("agents.stop")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Loop */}
      <div className="section-header section-header--spaced">
        <h2 className="li-flex">
          <span className="section-header__icon">⚙️</span>
          {t("agents.task_loops", { count: active_tasks.length })}
        </h2>
      </div>
      {!active_tasks.length ? (
        <div className="empty-state"><div className="empty-state__icon">⚙️</div><div className="empty-state__text">{t("agents.no_task_loops")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>{t("decisions.task")}</th><th>{t("agents.objective")}</th><th>{t("agents.turn")}</th><th>{t("agents.channel")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr>
            </thead>
            <tbody>
              {active_tasks.map((task) => (
                <tr key={task.taskId} className={WAITING_STATUSES.has(task.status) ? "row--waiting" : undefined}>
                  <td>
                    <b>{task.title || task.taskId.slice(0, 14)}</b>
                    <br /><span className="text-xs text-muted">{task.taskId.slice(0, 16)}</span>
                  </td>
                  <td className="truncate td--wide">{task.objective || "-"}</td>
                  <td><TurnBar current={task.currentTurn} max={task.maxTurns} /></td>
                  <td>{task.channel ? <ChannelRef channelId={task.channel} messageId={task.chat_id} /> : <span className="text-muted">-</span>}</td>
                  <td><Badge status={task.status} /></td>
                  <td>
                    <div className="li-flex">
                      <button className="btn btn--xs btn--danger" onClick={() => setCancelConfirm({ kind: "task", id: task.taskId, label: task.title || task.taskId.slice(0, 14) })}>{t("common.cancel")}</button>
                      {WAITING_STATUSES.has(task.status) && (
                        <button className="btn btn--xs btn--ok" onClick={() => setResumeTarget(task.taskId)}>{t("agents.resume")}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 완료 목록 */}
      {completed_tasks.length > 0 && (
        <div className="mt-3">
          <button className="btn btn--sm toggle-btn" aria-expanded={showCompleted} onClick={() => setShowCompleted((v) => !v)}>
            {showCompleted ? t("agents.hide_completed") : t("agents.show_completed", { count: completed_tasks.length })}
          </button>
          {showCompleted && (() => {
            const completed_statuses = [...new Set(completed_tasks.map((ct) => ct.status))];
            const filtered = completed_tasks.filter((task) => {
              if (completedStatusFilter !== "all" && task.status !== completedStatusFilter) return false;
              if (completedSearch) {
                const q = completedSearch.toLowerCase();
                return (task.title || "").toLowerCase().includes(q) || task.taskId.toLowerCase().includes(q);
              }
              return true;
            });
            return (
              <div className="mt-2">
                <div className="filter-bar">
                  <input type="search" className="filter-input" value={completedSearch} onChange={(e) => setCompletedSearch(e.target.value)} placeholder={t("agents.filter_placeholder")} />
                  <div className="ws-chip-bar">
                    {(["all", ...completed_statuses] as string[]).map((s) => (
                      <button key={s} className={`btn btn--xs ${completedStatusFilter === s ? "filter-btn--active" : "filter-btn"}`} onClick={() => setCompletedStatusFilter(s)}>
                        {s === "all" ? t("agents.filter_all") : s}
                      </button>
                    ))}
                  </div>
                  {(completedSearch || completedStatusFilter !== "all") && (
                    <span className="text-xs text-muted">{filtered.length} / {completed_tasks.length}</span>
                  )}
                </div>
                {filtered.length === 0 ? (
                  <div className="empty-state"><div className="empty-state__icon">🔍</div><div className="empty-state__text">{t("agents.filter_no_match")}</div></div>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table data-table--xs">
                      <thead>
                        <tr><th>{t("decisions.task")}</th><th>{t("common.status")}</th><th>{t("agents.turn")}</th><th>{t("agents.exit_reason")}</th><th>{t("agents.updated")}</th></tr>
                      </thead>
                      <tbody>
                        {filtered.map((task) => (
                          <tr key={task.taskId}>
                            <td>{STATUS_ICON[task.status] || "❓"} {task.title || task.taskId}<br /><span className="text-xs text-muted">{task.taskId.slice(0, 16)}</span></td>
                            <td><Badge status={task.status} /></td>
                            <td>{task.currentTurn}/{task.maxTurns}</td>
                            <td>{task.exitReason || "-"}</td>
                            <td className="text-sm text-muted" title={task.updatedAt || ""}>{task.updatedAt ? time_ago(task.updatedAt) : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* 서브에이전트 */}
      {agents.length > 0 && (
        <>
          <div className="section-header section-header--spaced">
            <h2 className="li-flex">
              <span className="section-header__icon">🤖</span>
              {t("agents.once_title", { count: agents.length })}
            </h2>
          </div>
          <div className="office-grid">
            {agents.map((a) => {
              const cls = classify_agent(a.status);
              return (
                <article key={a.id} className={`desk desk--${cls}`}>
                  <div className="desk__name">{a.label || a.id}</div>
                  <div className="desk__role">{a.role || "-"} · {a.model || "-"}</div>
                  <div className={`desk__status desk__status--${cls}`}>{cls.toUpperCase()}</div>
                  {a.last_message && <div className="text-sm text-muted truncate mt-1">{a.last_message}</div>}
                  {a.last_error && <div className="text-xs text-err mt-1">{a.last_error}</div>}
                  <div className="desk__actions">
                    {cls === "working" && (
                      <>
                        <button className="btn btn--xs btn--danger" onClick={() => setCancelConfirm({ kind: "agent", id: a.id, label: a.label || a.id })}>{t("common.cancel")}</button>
                        <button className="btn btn--xs" onClick={() => setSendTarget(a.id)}>{t("common.send")}</button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
