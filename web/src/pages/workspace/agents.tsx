import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { Modal, DeleteConfirmModal } from "../../components/modal";
import { FormGroup } from "../../components/form-group";
import { SectionHeader } from "../../components/section-header";
import { SendAgentModal } from "../../components/send-agent-modal";
import { classify_agent } from "../../utils/classify";
import { fmt_time, time_ago } from "../../utils/format";
import { useT } from "../../i18n";
import { DataTable } from "../../components/data-table";
import { ChipBar } from "../../components/chip-bar";
import { Collapsible } from "../../components/collapsible";
import { useAsyncAction } from "../../hooks/use-async-action";
import { useTableFilter } from "../../hooks/use-table-filter";
import { useAuthStatus, useAuthUser } from "../../hooks/use-auth";

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
  const run_action = useAsyncAction();

  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["agents"], queryFn: () => api.get("/api/agents"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: agent_loops = [] } = useQuery<AgentLoop[]>({ queryKey: ["loops"], queryFn: () => api.get("/api/loops"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: task_loops = [] } = useQuery<TaskLoop[]>({ queryKey: ["tasks"], queryFn: () => api.get("/api/tasks"), refetchInterval: 15_000, staleTime: 5_000 });
  const { data: raw_processes } = useQuery<{ active: ProcessEntry[]; recent: ProcessEntry[] }>(
    { queryKey: ["processes"], queryFn: () => api.get("/api/processes"), refetchInterval: 15_000, staleTime: 5_000 }
  );

  const { data: auth_status } = useAuthStatus();
  const { data: auth_user } = useAuthUser();
  const auth_enabled = auth_status?.enabled ?? false;

  // FE-6: 프로세스를 sender_id로 필터 (방어 레이어 — 백엔드 team_id 스코핑이 1차 경계)
  const processes_data = useMemo(() => {
    if (!raw_processes) return undefined;
    if (!auth_enabled || !auth_user?.sub || auth_user.role === "superadmin") return raw_processes;
    const filter_fn = (p: ProcessEntry) => !p.sender_id || p.sender_id === auth_user.sub;
    return {
      active: raw_processes.active.filter(filter_fn),
      recent: raw_processes.recent.filter(filter_fn),
    };
  }, [raw_processes, auth_enabled, auth_user]);

  const [sendTarget, setSendTarget] = useState<string | null>(null);
  const [resumeTarget, setResumeTarget] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState<{ kind: string; id: string; label: string } | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRecentProcesses, setShowRecentProcesses] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["agents"] });
    void qc.invalidateQueries({ queryKey: ["loops"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["processes"] });
  };

  const active_tasks = task_loops.filter((tl) => ACTIVE_STATUSES.has(tl.status));
  const completed_tasks = task_loops.filter((tl) => !ACTIVE_STATUSES.has(tl.status));

  const DONE_STATUSES = new Set(["completed", "failed", "cancelled", "offline"]);
  const active_agents = agents.filter((a) => !DONE_STATUSES.has(a.status));

  const { filtered: filtered_completed, search: completedSearch, setSearch: setCompletedSearch,
    statusFilter: completedStatusFilter, setStatusFilter: setCompletedStatusFilter,
    statusOptions: completed_statuses, isFiltered: completedIsFiltered } =
    useTableFilter(completed_tasks, { searchFields: ["title", "taskId"], statusField: "status" });

  const active_processes = processes_data?.active ?? [];
  const recent_processes = processes_data?.recent ?? [];

  const handle_send = (agentId: string, text: string) =>
    void run_action(
      () => api.post(`/api/agents/${encodeURIComponent(agentId)}/input`, { text }).then(() => { setSendTarget(null); refresh(); }),
      t("agents.message_sent"),
    );

  const confirm_cancel = () => {
    if (!cancelConfirm) return;
    const { kind, id } = cancelConfirm;
    setCancelConfirm(null);
    const after = () => refresh();
    if (kind === "agent") void run_action(() => api.del(`/api/agents/${encodeURIComponent(id)}`).then(after), t("agents.cancelled"));
    else if (kind === "loop") void run_action(() => api.del(`/api/loops/${encodeURIComponent(id)}`).then(after), t("agents.loop_stopped"));
    else if (kind === "task") void run_action(() => api.del(`/api/tasks/${encodeURIComponent(id)}`).then(after), t("agents.task_cancelled"));
    else if (kind === "process") void run_action(() => api.del(`/api/processes/${encodeURIComponent(id)}`).then(after), t("agents.process_cancelled"));
  };
  const confirm_resume = () => {
    if (!resumeTarget) return;
    void run_action(
      () => api.put(`/api/tasks/${encodeURIComponent(resumeTarget)}`, { text: resumeText || undefined }).then(() => { setResumeTarget(null); setResumeText(""); refresh(); }),
      t("agents.task_resumed"),
    );
  };

  return (
    <>
      <SendAgentModal agentId={sendTarget} onClose={() => setSendTarget(null)} onSend={(id, text) => void handle_send(id, text)} />

      <DeleteConfirmModal
        open={!!cancelConfirm}
        title={t("agents.cancel_confirm_title")}
        message={t("agents.cancel_confirm_desc", { label: cancelConfirm?.label ?? "" })}
        onClose={() => setCancelConfirm(null)}
        onConfirm={confirm_cancel}
        confirmLabel={t("common.confirm")}
      />

      <Modal open={!!resumeTarget} title={t("agents.resume_task")} onClose={() => { setResumeTarget(null); setResumeText(""); }} onConfirm={() => void confirm_resume()} confirmLabel={t("agents.resume")}>
        <FormGroup label={t("agents.user_input")}>
          <textarea autoFocus className="form-input resize-y" value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={3} />
        </FormGroup>
      </Modal>

      {/* 실행 프로세스 */}
      <SectionHeader titleClassName="li-flex" title={<>
        <span className="section-header__icon">⚡</span>
        {t("agents.processes_title")}
        {active_processes.length > 0 && (
          <span className="section-header__badge">{t("agents.processes_active", { count: active_processes.length })}</span>
        )}
      </>} />

      {!active_processes.length ? (
        <EmptyState type="empty" title={t("agents.no_processes")} icon="⚡" />
      ) : (
        <DataTable>
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
          </DataTable>
      )}

      {recent_processes.length > 0 && (
        <Collapsible
          className="mt-2"
          open={showRecentProcesses}
          onToggle={setShowRecentProcesses}
          label={showRecentProcesses ? t("agents.hide_recent") : t("agents.show_recent", { count: recent_processes.length })}
        >
          <DataTable small>
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
          </DataTable>
        </Collapsible>
      )}

      {/* Agent Loop */}
      <SectionHeader className="section-header--spaced" titleClassName="li-flex" title={<>
        <span className="section-header__icon">🔄</span>
        {t("agents.agent_loops", { count: agent_loops.length })}
      </>} />
      {!agent_loops.length ? (
        <EmptyState type="empty" title={t("agents.no_agent_loops")} icon="🔄" />
      ) : (
        <DataTable>
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
          </DataTable>
      )}

      {/* Task Loop */}
      <SectionHeader className="section-header--spaced" titleClassName="li-flex" title={<>
        <span className="section-header__icon">⚙️</span>
        {t("agents.task_loops", { count: active_tasks.length })}
      </>} />
      {!active_tasks.length ? (
        <EmptyState type="empty" title={t("agents.no_task_loops")} icon="⚙️" />
      ) : (
        <DataTable>
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
          </DataTable>
      )}

      {/* 완료 목록 */}
      {completed_tasks.length > 0 && (
        <Collapsible
          className="mt-3"
          open={showCompleted}
          onToggle={setShowCompleted}
          label={showCompleted ? t("agents.hide_completed") : t("agents.show_completed", { count: completed_tasks.length })}
        >
          <div className="filter-bar">
            <input type="search" className="filter-input" value={completedSearch} onChange={(e) => setCompletedSearch(e.target.value)} placeholder={t("agents.filter_placeholder")} />
            <ChipBar
              options={[
                { value: "all", label: t("agents.filter_all") },
                ...completed_statuses.map((s) => ({ value: s, label: s })),
              ]}
              value={completedStatusFilter}
              onChange={setCompletedStatusFilter}
            />
            {completedIsFiltered && (
              <span className="text-xs text-muted">{filtered_completed.length} / {completed_tasks.length}</span>
            )}
          </div>
          {filtered_completed.length === 0 ? (
            <EmptyState type="no-results" title={t("agents.filter_no_match")} icon="🔍" />
          ) : (
            <DataTable small>
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
                    <td className="text-sm text-muted" title={task.updatedAt || ""}>{task.updatedAt ? time_ago(task.updatedAt) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Collapsible>
      )}

      {/* 서브에이전트 — 완료/실패/취소 상태는 표시하지 않음 */}
      {active_agents.length > 0 && (
        <>
          <SectionHeader className="section-header--spaced" titleClassName="li-flex" title={<>
            <span className="section-header__icon">🤖</span>
            {t("agents.once_title", { count: active_agents.length })}
          </>} />
          <div className="office-grid">
            {active_agents.map((a) => {
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
                        <button className="btn btn--xs btn--ok" onClick={() => setSendTarget(a.id)}>{t("agents.resume")}</button>
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
