import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { SendAgentModal } from "../../components/send-agent-modal";
import { useToast } from "../../components/toast";
import { classify_agent } from "../../utils/classify";
import { useT } from "../../i18n";

interface Agent {
  id: string; label: string; role: string; model: string; status: string;
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

const MODE_COLOR: Record<string, string> = {
  once: "var(--muted)", agent: "var(--accent)", task: "#16a34a",
};

function fmt_time(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

function ChannelRef({ channelId, messageId }: { channelId: string; messageId?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      <Badge status={channelId} variant="info" />
      {messageId && <span className="text-muted" style={{ fontSize: 10 }}>#{messageId.slice(-6)}</span>}
    </span>
  );
}

export function AgentsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["agents"], queryFn: () => api.get("/api/agents"), refetchInterval: 5000 });
  const { data: agent_loops = [] } = useQuery<AgentLoop[]>({ queryKey: ["loops"], queryFn: () => api.get("/api/loops"), refetchInterval: 5000 });
  const { data: task_loops = [] } = useQuery<TaskLoop[]>({ queryKey: ["tasks"], queryFn: () => api.get("/api/tasks"), refetchInterval: 5000 });
  const { data: processes_data } = useQuery<{ active: ProcessEntry[]; recent: ProcessEntry[] }>(
    { queryKey: ["processes"], queryFn: () => api.get("/api/processes"), refetchInterval: 3000 }
  );

  const [sendTarget, setSendTarget] = useState<string | null>(null);
  const [resumeTarget, setResumeTarget] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
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

  const active_tasks = task_loops.filter((t) => ACTIVE_STATUSES.has(t.status));
  const completed_tasks = task_loops.filter((t) => !ACTIVE_STATUSES.has(t.status));
  const completed_statuses = [...new Set(completed_tasks.map((t) => t.status))];
  const filtered_completed = completed_tasks.filter((task) => {
    if (completedStatusFilter !== "all" && task.status !== completedStatusFilter) return false;
    if (completedSearch) {
      const q = completedSearch.toLowerCase();
      return (task.title || "").toLowerCase().includes(q) || task.taskId.toLowerCase().includes(q);
    }
    return true;
  });

  const active_processes = processes_data?.active ?? [];
  const recent_processes = processes_data?.recent ?? [];

  const cancel_agent = async (id: string) => { await api.post(`/api/agents/${id}/cancel`); toast(t("agents.cancelled"), "ok"); refresh(); };
  const handle_send = async (agentId: string, text: string) => { await api.post(`/api/agents/${agentId}/send`, { text }); toast(t("agents.message_sent"), "ok"); setSendTarget(null); refresh(); };
  const stop_loop = async (loopId: string) => { await api.post(`/api/loops/${loopId}/stop`, { reason: "stopped_from_dashboard" }); toast(t("agents.loop_stopped"), "ok"); refresh(); };
  const cancel_task = async (taskId: string) => { await api.post(`/api/tasks/${taskId}/cancel`); toast(t("agents.task_cancelled"), "ok"); refresh(); };
  const cancel_process = async (run_id: string) => { await api.post(`/api/processes/${run_id}/cancel`); toast(t("agents.process_cancelled"), "ok"); refresh(); };
  const confirm_resume = async () => {
    if (!resumeTarget) return;
    await api.post(`/api/tasks/${resumeTarget}/resume`, { text: resumeText || undefined });
    toast(t("agents.task_resumed"), "ok");
    setResumeTarget(null);
    setResumeText("");
    refresh();
  };

  return (
    <>
      <SendAgentModal agentId={sendTarget} onClose={() => setSendTarget(null)} onSend={(id, text) => void handle_send(id, text)} />

      <Modal open={!!resumeTarget} title={t("agents.resume_task")} onClose={() => { setResumeTarget(null); setResumeText(""); }} onConfirm={() => void confirm_resume()} confirmLabel={t("agents.resume")}>
        <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{t("agents.user_input")}</label>
        <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={3}
          style={{ width: "100%", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", padding: 8, fontFamily: "inherit", fontSize: 12, resize: "vertical" }} />
      </Modal>

      {/* 실행 프로세스 */}
      <div className="section-header" style={{ marginBottom: 8 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          {t("agents.processes_title")}
          {active_processes.length > 0 && (
            <span style={{ fontSize: 11, background: "var(--accent)", color: "#fff", borderRadius: 4, padding: "1px 6px", marginLeft: 4 }}>
              {t("agents.processes_active", { count: active_processes.length })}
            </span>
          )}
        </h2>
      </div>

      {!active_processes.length ? (
        <p className="empty">{t("agents.no_processes")}</p>
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
                    <span style={{ fontSize: 11, fontWeight: 600, color: MODE_COLOR[p.mode] ?? "var(--muted)", background: "color-mix(in srgb, currentColor 10%, transparent)", padding: "2px 6px", borderRadius: 4, border: "1px solid currentColor" }}>
                      {p.mode}
                    </span>
                  </td>
                  <td className="text-sm">{p.provider}<br /><span className="text-xs text-muted">{p.alias}</span></td>
                  <td className="text-sm text-muted">{p.executor_provider || "-"}</td>
                  <td className="text-sm">{p.tool_calls_count}</td>
                  <td className="text-xs text-muted">{fmt_time(p.started_at)}</td>
                  <td><Badge status={p.status} /></td>
                  <td><button className="btn btn--xs btn--danger" onClick={() => void cancel_process(p.run_id)}>{t("agents.process_cancel")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recent_processes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn--sm" onClick={() => setShowRecentProcesses((v) => !v)} style={{ color: "var(--muted)", background: "none", border: "1px solid var(--line)" }}>
            {showRecentProcesses ? t("agents.hide_recent") : t("agents.show_recent", { count: recent_processes.length })}
          </button>
          {showRecentProcesses && (
            <div className="table-scroll" style={{ marginTop: 8, opacity: 0.75 }}>
              <table className="data-table" style={{ fontSize: 11 }}>
                <thead>
                  <tr><th>Run ID</th><th>{t("agents.mode")}</th><th>{t("agents.provider")}</th><th>{t("agents.executor")}</th><th>{t("agents.tools")}</th><th>{t("common.status")}</th><th>{t("agents.started")}</th><th>{t("agents.ended")}</th></tr>
                </thead>
                <tbody>
                  {recent_processes.map((p) => (
                    <tr key={p.run_id}>
                      <td className="text-xs text-muted">{p.run_id}</td>
                      <td><span style={{ fontSize: 10, fontWeight: 600, color: MODE_COLOR[p.mode] ?? "var(--muted)" }}>{p.mode}</span></td>
                      <td>{p.provider} / {p.alias}</td>
                      <td>{p.executor_provider || "-"}</td>
                      <td>{p.tool_calls_count}</td>
                      <td>{STATUS_ICON[p.status] || ""} <Badge status={p.status} />{p.error && <span className="text-xs" style={{ color: "var(--err)", marginLeft: 4 }}>⚠ {p.error}</span>}</td>
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
      <div className="section-header" style={{ marginTop: 20, marginBottom: 8 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>🔄</span>
          {t("agents.agent_loops", { count: agent_loops.length })}
        </h2>
      </div>
      {!agent_loops.length ? (
        <p className="empty">{t("agents.no_agent_loops")}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>{t("agents.id")}</th><th>{t("agents.objective")}</th><th>{t("agents.turn")}</th><th>{t("agents.channel")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr>
            </thead>
            <tbody>
              {agent_loops.map((l) => (
                <tr key={l.loopId} style={WAITING_STATUSES.has(l.status) ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
                  <td className="text-xs text-muted">{l.loopId.slice(0, 12)}</td>
                  <td className="truncate" style={{ maxWidth: 280 }}>{l.objective || "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l.currentTurn}/{l.maxTurns}</td>
                  <td>{l.channelId ? <ChannelRef channelId={l.channelId} messageId={l.messageId} /> : <span className="text-muted">-</span>}</td>
                  <td><Badge status={l.status} /></td>
                  <td><button className="btn btn--xs btn--danger" onClick={() => void stop_loop(l.loopId)}>{t("agents.stop")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Loop */}
      <div className="section-header" style={{ marginTop: 20, marginBottom: 8 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>⚙️</span>
          {t("agents.task_loops", { count: active_tasks.length })}
        </h2>
      </div>
      {!active_tasks.length ? (
        <p className="empty">{t("agents.no_task_loops")}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>{t("decisions.task")}</th><th>{t("agents.objective")}</th><th>{t("agents.turn")}</th><th>{t("agents.channel")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr>
            </thead>
            <tbody>
              {active_tasks.map((task) => (
                <tr key={task.taskId} style={WAITING_STATUSES.has(task.status) ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
                  <td>
                    <b>{task.title || task.taskId.slice(0, 14)}</b>
                    <br /><span className="text-xs text-muted">{task.taskId.slice(0, 16)}</span>
                  </td>
                  <td className="truncate" style={{ maxWidth: 240 }}>{task.objective || "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{task.currentTurn}/{task.maxTurns}</td>
                  <td>{task.channel ? <ChannelRef channelId={task.channel} messageId={task.chat_id} /> : <span className="text-muted">-</span>}</td>
                  <td><Badge status={task.status} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn--xs btn--danger" onClick={() => void cancel_task(task.taskId)}>{t("common.cancel")}</button>
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
        <div style={{ marginTop: 20 }}>
          <button className="btn btn--sm" onClick={() => setShowCompleted((v) => !v)} style={{ color: "var(--muted)", background: "none", border: "1px solid var(--line)" }}>
            {showCompleted ? t("agents.hide_completed") : t("agents.show_completed", { count: completed_tasks.length })}
          </button>
          {showCompleted && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <input type="search" value={completedSearch} onChange={(e) => setCompletedSearch(e.target.value)} placeholder={t("agents.filter_placeholder")}
                  style={{ fontSize: 12, padding: "4px 8px", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 4, width: 180 }} />
                <div style={{ display: "flex", gap: 4 }}>
                  {(["all", ...completed_statuses] as string[]).map((s) => (
                    <button key={s} className="btn btn--xs" onClick={() => setCompletedStatusFilter(s)}
                      style={{ opacity: completedStatusFilter === s ? 1 : 0.45, background: completedStatusFilter === s ? "var(--accent)" : "none", color: completedStatusFilter === s ? "#fff" : "var(--text)", border: "1px solid var(--line)" }}>
                      {s === "all" ? t("agents.filter_all") : s}
                    </button>
                  ))}
                </div>
                {(completedSearch || completedStatusFilter !== "all") && (
                  <span className="text-xs text-muted">{filtered_completed.length} / {completed_tasks.length}</span>
                )}
              </div>
              {filtered_completed.length === 0 ? (
                <p className="empty" style={{ fontSize: 12 }}>{t("agents.filter_no_match")}</p>
              ) : (
                <div className="table-scroll" style={{ opacity: 0.8 }}>
                  <table className="data-table" style={{ fontSize: 11 }}>
                    <thead>
                      <tr><th>{t("decisions.task")}</th><th>{t("common.status")}</th><th>{t("agents.turn")}</th><th>{t("agents.exit_reason")}</th><th>{t("agents.updated")}</th></tr>
                    </thead>
                    <tbody>
                      {filtered_completed.map((task) => (
                        <tr key={task.taskId}>
                          <td>{STATUS_ICON[task.status] || "❓"} {task.title || task.taskId}<br /><span className="text-xs text-muted">{task.taskId.slice(0, 16)}</span></td>
                          <td><Badge status={task.status} /></td>
                          <td>{task.currentTurn}/{task.maxTurns}</td>
                          <td>{task.exitReason || "-"}</td>
                          <td className="text-sm text-muted">{task.updatedAt || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 서브에이전트 */}
      {agents.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 20, marginBottom: 8 }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }}>🤖</span>
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
                  {a.last_message && <div className="text-sm text-muted truncate" style={{ marginTop: 4 }}>{a.last_message}</div>}
                  {a.last_error && <div className="text-xs" style={{ color: "var(--err)", marginTop: 2 }}>{a.last_error}</div>}
                  <div className="desk__actions">
                    <button className="btn btn--xs btn--danger" onClick={() => void cancel_agent(a.id)}>{t("common.cancel")}</button>
                    <button className="btn btn--xs" onClick={() => setSendTarget(a.id)}>{t("common.send")}</button>
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
