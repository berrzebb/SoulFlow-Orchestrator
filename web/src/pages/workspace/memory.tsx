import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { Modal, DeleteConfirmModal } from "../../components/modal";
import { FormGroup } from "../../components/form-group";
import { WsListItem, WsDetailHeader, WsSkeletonCol } from "./ws-shared";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { time_ago } from "../../utils/format";
import { SplitPane } from "./split-pane";
import { DataTable } from "../../components/data-table";
import { useAsyncAction } from "../../hooks/use-async-action";

interface DailyListResponse { days: string[] }
interface MemoryContentResponse { content: string }

interface Decision { id: string; canonical_key: string; value: unknown; priority: number }
interface PromiseRecord { id: string; canonical_key: string; value: string; priority: number }
interface WorkflowEvent { event_id: string; task_id: string; agent_id: string; phase: string; summary: string; at: string }

type MemoryView = "longterm" | { day: string } | "decisions" | "promises" | "events";


export function MemoryTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run_action = useAsyncAction();
  const [view, setView] = useState<MemoryView>("longterm");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [showAddPromise, setShowAddPromise] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newPriority, setNewPriority] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: daily_list } = useQuery<DailyListResponse>({
    queryKey: ["memory-daily-list"],
    queryFn: () => api.get("/api/memory/daily"),
  });

  const { data: state } = useQuery<Record<string, unknown>>({
    queryKey: ["state"],
    queryFn: () => api.get("/api/state"),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const is_text_view = view === "longterm" || typeof view === "object";

  const { data: content_data, isLoading: content_loading } = useQuery<MemoryContentResponse>({
    queryKey: ["memory-content", view],
    queryFn: () =>
      view === "longterm"
        ? api.get("/api/memory/longterm")
        : api.get(`/api/memory/daily/${encodeURIComponent((view as { day: string }).day)}`),
    enabled: is_text_view,
  });

  const save = useMutation({
    mutationFn: (text: string) =>
      view === "longterm"
        ? api.put("/api/memory/longterm", { content: text })
        : api.put(`/api/memory/daily/${encodeURIComponent((view as { day: string }).day)}`, { content: text }),
    onSuccess: () => {
      toast(t("workspace.memory.saved"), "ok");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["memory-content", view] });
    },
    onError: () => toast(t("workspace.memory.save_failed"), "err"),
  });

  const today = new Date().toISOString().slice(0, 10);
  const days = daily_list?.days ?? [];
  const decisions = (state?.decisions ?? []) as Decision[];
  const promises = (state?.promises ?? []) as PromiseRecord[];
  const events = (state?.workflow_events ?? []) as WorkflowEvent[];

  const view_day = typeof view === "object" ? (view as { day: string }).day : null;

  const reset_form = () => { setNewKey(""); setNewValue(""); setNewPriority(0); };

  const add_promise = () => {
    if (!newKey.trim() || !newValue.trim()) return Promise.resolve();
    return run_action(
      () => api.post("/api/promises", { key: newKey.trim(), value: newValue.trim(), priority: newPriority })
        .then(() => { reset_form(); setShowAddPromise(false); void qc.invalidateQueries({ queryKey: ["state"] }); }),
      t("promises.added"),
      t("promises.add_failed"),
    );
  };

  const delete_promise = (id: string) =>
    run_action(
      () => api.del(`/api/promises/${encodeURIComponent(id)}`)
        .then(() => { setDeleteTarget(null); void qc.invalidateQueries({ queryKey: ["state"] }); }),
      t("promises.deleted"),
      t("promises.delete_failed"),
    );

  const section_label = (label: string) => (
    <div className="ws-group-label ws-group-label--section">
      <span className="text-muted">{label}</span>
    </div>
  );

  const right_header = (title: string, action?: ReactNode) => (
    <WsDetailHeader>
      <span className="fw-600 text-sm">{title}</span>
      {action}
    </WsDetailHeader>
  );

  const right_content = () => {
    if (view === "decisions") {
      return (
        <div className="ws-col">
          {right_header(t("workspace.memory.decisions"))}
          <div className="ws-preview">
            {!decisions.length ? (
              <EmptyState icon="📋" title={t("decisions.no_decisions")} />
            ) : (
              <DataTable>
                <thead><tr><th>{t("decisions.priority")}</th><th>{t("decisions.key")}</th><th>{t("decisions.value")}</th></tr></thead>
                <tbody>
                  {decisions.map((d) => {
                    const val_str = typeof d.value === "object" ? JSON.stringify(d.value, null, 2) : String(d.value);
                    return (
                      <tr key={d.id}>
                        <td><Badge status={`p${d.priority}`} variant="info" /></td>
                        <td><b>{d.canonical_key}</b></td>
                        <td className="expandable-cell" title={val_str}>
                          {val_str}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
          </div>
        </div>
      );
    }

    if (view === "promises") {
      return (
        <div className="ws-col">
          {right_header(t("workspace.memory.promises"),
            <button className="btn btn--xs btn--ok" onClick={() => setShowAddPromise(true)}>{t("promises.add")}</button>
          )}
          <div className="ws-preview">
            {!promises.length ? (
              <EmptyState icon="🤝" title={t("promises.no_promises")} />
            ) : (
              <DataTable>
                <thead><tr><th>{t("decisions.priority")}</th><th>{t("decisions.key")}</th><th>{t("decisions.value")}</th><th className="th--actions"></th></tr></thead>
                <tbody>
                  {promises.map((p) => (
                    <tr key={p.id}>
                      <td><Badge status={`p${p.priority}`} variant="warn" /></td>
                      <td><b>{p.canonical_key}</b></td>
                      <td className="expandable-cell" title={p.value}>{p.value}</td>
                      <td><button className="btn btn--xs btn--danger" onClick={() => setDeleteTarget(p.id)} aria-label={t("common.delete")}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        </div>
      );
    }

    if (view === "events") {
      return (
        <div className="ws-col">
          {right_header(t("workspace.memory.events"))}
          <div className="ws-preview">
            {!events.length ? (
              <EmptyState icon="📊" title={t("decisions.no_events")} />
            ) : (
              <DataTable>
                <thead><tr><th>{t("decisions.phase")}</th><th>{t("decisions.task")}</th><th>{t("decisions.agent")}</th><th>{t("decisions.summary")}</th><th>{t("decisions.time")}</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.event_id}>
                      <td><Badge status={e.phase} /></td>
                      <td className="text-xs">{e.task_id || "-"}</td>
                      <td className="text-xs">{e.agent_id || "-"}</td>
                      <td className="truncate td--wide">{e.summary || "-"}</td>
                      <td className="text-xs text-muted" title={e.at}>{e.at ? time_ago(e.at) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        </div>
      );
    }

    // 텍스트 뷰 (longterm / daily)
    const label = view === "longterm" ? t("workspace.memory.longterm") : view_day;
    return (
      <div className="ws-col">
        {right_header(label ?? "",
          !editing ? (
            <button className="btn btn--xs" onClick={() => { setEditText(content_data?.content ?? ""); setEditing(true); }}>
              {t("common.edit")}
            </button>
          ) : (
            <div className="li-flex">
              <button className="btn btn--xs" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
              <button className="btn btn--xs btn--accent" onClick={() => save.mutate(editText)} disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("workspace.memory.save")}
              </button>
            </div>
          )
        )}
        <div className="ws-col flex-fill">
          {content_loading ? (
            <WsSkeletonCol rows={["text", "text", "text-sm"]} />
          ) : editing ? (
            <textarea autoFocus className="ws-editor ws-editor--editing" value={editText} onChange={(e) => setEditText(e.target.value)} />
          ) : (
            <div className="ws-preview">
              <pre>{content_data?.content || <span className="text-muted">-</span>}</pre>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <SplitPane
        left={
          <div className="ws-scroll">
            {/* 메모리 */}
            <WsListItem id="longterm" active={view === "longterm"} onClick={() => { setView("longterm"); setEditing(false); }}>
              <span className="fw-600">{t("workspace.memory.longterm")}</span>
            </WsListItem>
            {section_label(t("workspace.memory.daily"))}
            <WsListItem id="today" active={typeof view === "object" && (view as { day: string }).day === today} onClick={() => { setView({ day: today }); setEditing(false); }}>
              {today} <Badge status={t("workspace.memory.today")} variant="ok" />
            </WsListItem>
            {days.filter((d) => d !== today).map((day) => (
              <WsListItem key={day} id={day} active={typeof view === "object" && (view as { day: string }).day === day} onClick={() => { setView({ day }); setEditing(false); }}>
                {day}
              </WsListItem>
            ))}
            {days.length === 0 && (
              <div className="ws-item text-muted">{t("workspace.memory.no_daily")}</div>
            )}

            {/* 결정사항 / 약속 / 이벤트 */}
            {section_label(t("workspace.memory.decisions"))}
            <WsListItem id="decisions" active={view === "decisions"} onClick={() => setView("decisions")}>
              {t("workspace.memory.decisions")} <span className="text-xs text-muted">({decisions.length})</span>
            </WsListItem>
            <WsListItem id="promises" active={view === "promises"} onClick={() => setView("promises")}>
              {t("workspace.memory.promises")} <span className="text-xs text-muted">({promises.length})</span>
            </WsListItem>
            <WsListItem id="events" active={view === "events"} onClick={() => setView("events")}>
              {t("workspace.memory.events")} <span className="text-xs text-muted">({events.length})</span>
            </WsListItem>
          </div>
        }
        right={right_content()}
      />

      <Modal
        open={showAddPromise}
        title={t("promises.add")}
        onClose={() => { setShowAddPromise(false); reset_form(); }}
        onConfirm={() => void add_promise()}
        confirmLabel={t("common.save")}
        submitDisabled={!newKey.trim() || !newValue.trim()}
      >
        <div className="modal__form-body">
          <FormGroup label={t("decisions.key")}>
            <input autoFocus className="form-input" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={t("promises.key_placeholder")} onKeyDown={(e) => { if (e.key === "Enter" && newKey.trim() && newValue.trim()) void add_promise(); }} />
          </FormGroup>
          <FormGroup label={t("decisions.value")}>
            <input className="form-input" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={t("promises.value_placeholder")} onKeyDown={(e) => { if (e.key === "Enter" && newKey.trim() && newValue.trim()) void add_promise(); }} />
          </FormGroup>
          <FormGroup label={t("decisions.priority")}>
            <select className="form-input" value={newPriority} onChange={(e) => setNewPriority(Number(e.target.value))}>
              <option value={0}>{t("decisions.p0")}</option>
              <option value={1}>{t("decisions.p1")}</option>
              <option value={2}>{t("decisions.p2")}</option>
              <option value={3}>{t("decisions.p3")}</option>
            </select>
          </FormGroup>
        </div>
      </Modal>

      <DeleteConfirmModal
        open={!!deleteTarget}
        title={t("promises.confirm_delete")}
        message={t("promises.delete_warning")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void delete_promise(deleteTarget)}
        confirmLabel={t("common.delete")}
      />
    </>
  );
}
