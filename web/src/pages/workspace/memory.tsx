import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { SplitPane } from "./split-pane";

interface DailyListResponse { days: string[] }
interface MemoryContentResponse { content: string }

interface Decision { id: string; canonical_key: string; value: unknown; priority: number }
interface PromiseRecord { id: string; canonical_key: string; value: string; priority: number }
interface WorkflowEvent { event_id: string; task_id: string; agent_id: string; phase: string; summary: string; at: string }

type MemoryView = "longterm" | { day: string } | "decisions" | "promises" | "events";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%", background: "var(--bg)", color: "var(--text)",
  border: "1px solid var(--line)", padding: "6px 10px",
  fontFamily: "inherit", fontSize: 12, borderRadius: 4,
};

export function MemoryTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
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

  const add_promise = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    await api.post("/api/promises", { key: newKey.trim(), value: newValue.trim(), priority: newPriority });
    reset_form();
    setShowAddPromise(false);
    toast(t("promises.added"), "ok");
    void qc.invalidateQueries({ queryKey: ["state"] });
  };

  const delete_promise = async (id: string) => {
    await api.del(`/api/promises/${id}`);
    setDeleteTarget(null);
    toast(t("promises.deleted"), "ok");
    void qc.invalidateQueries({ queryKey: ["state"] });
  };

  const nav_item = (active: boolean, onClick: () => void, children: React.ReactNode) => (
    <div
      onClick={onClick}
      style={{
        padding: "8px 14px", cursor: "pointer", fontSize: 12,
        background: active ? "var(--panel-elevated)" : "none",
        borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
      }}
    >
      {children}
    </div>
  );

  const section_label = (label: string) => (
    <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0", padding: "6px 14px 2px" }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
    </div>
  );

  const right_header = (title: string, action?: React.ReactNode) => (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      {action}
    </div>
  );

  const right_content = () => {
    if (view === "decisions") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {right_header(t("workspace.memory.decisions"))}
          <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
            {!decisions.length ? (
              <p className="empty">{t("decisions.no_decisions")}</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>{t("decisions.priority")}</th><th>{t("decisions.key")}</th><th>{t("decisions.value")}</th></tr></thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id}>
                      <td><Badge status={`p${d.priority}`} variant="info" /></td>
                      <td><b>{d.canonical_key}</b></td>
                      <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {typeof d.value === "object" ? JSON.stringify(d.value) : String(d.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    }

    if (view === "promises") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {right_header(t("workspace.memory.promises"),
            <button className="btn btn--xs btn--ok" onClick={() => setShowAddPromise(true)}>{t("promises.add")}</button>
          )}
          <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
            {!promises.length ? (
              <p className="empty">{t("promises.no_promises")}</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>{t("decisions.priority")}</th><th>{t("decisions.key")}</th><th>{t("decisions.value")}</th><th style={{ width: 60 }}></th></tr></thead>
                <tbody>
                  {promises.map((p) => (
                    <tr key={p.id}>
                      <td><Badge status={`p${p.priority}`} variant="warn" /></td>
                      <td><b>{p.canonical_key}</b></td>
                      <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.value}</td>
                      <td><button className="btn btn--xs btn--danger" onClick={() => setDeleteTarget(p.id)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    }

    if (view === "events") {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {right_header(t("workspace.memory.events"))}
          <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
            {!events.length ? (
              <p className="empty">{t("decisions.no_events")}</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>{t("decisions.phase")}</th><th>{t("decisions.task")}</th><th>{t("decisions.agent")}</th><th>{t("decisions.summary")}</th><th>{t("decisions.time")}</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.event_id}>
                      <td><Badge status={e.phase} /></td>
                      <td style={{ fontSize: 11 }}>{e.task_id || "-"}</td>
                      <td style={{ fontSize: 11 }}>{e.agent_id || "-"}</td>
                      <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.summary || "-"}</td>
                      <td style={{ fontSize: 11, color: "var(--muted)" }}>{e.at || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    }

    // 텍스트 뷰 (longterm / daily)
    const label = view === "longterm" ? t("workspace.memory.longterm") : view_day;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {right_header(label ?? "",
          !editing ? (
            <button className="btn btn--xs" onClick={() => { setEditText(content_data?.content ?? ""); setEditing(true); }}>
              {t("common.edit")}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn--xs" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
              <button className="btn btn--xs btn--accent" onClick={() => save.mutate(editText)} disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("workspace.memory.save")}
              </button>
            </div>
          )
        )}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {content_loading ? (
            <p className="empty">{t("common.loading")}</p>
          ) : editing ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              style={{
                flex: 1, resize: "none", border: "none", background: "var(--bg)",
                color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12,
                lineHeight: 1.6, padding: 14, outline: "none",
              }}
            />
          ) : (
            <pre style={{
              flex: 1, margin: 0, padding: 14, overflow: "auto",
              fontSize: 12, whiteSpace: "pre-wrap", lineHeight: 1.6,
              fontFamily: "var(--font-mono)", color: "var(--text)",
            }}>
              {content_data?.content || <span style={{ color: "var(--muted)" }}>-</span>}
            </pre>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <SplitPane
        left={
          <div style={{ overflowY: "auto", flex: 1 }}>
            {/* 메모리 */}
            {nav_item(view === "longterm", () => { setView("longterm"); setEditing(false); },
              <span style={{ fontWeight: 600 }}>{t("workspace.memory.longterm")}</span>
            )}
            {section_label(t("workspace.memory.daily"))}
            {nav_item(typeof view === "object" && (view as { day: string }).day === today, () => { setView({ day: today }); setEditing(false); },
              <>{today} <Badge status={t("workspace.memory.today")} variant="ok" /></>
            )}
            {days.filter((d) => d !== today).map((day) => (
              <div
                key={day}
                onClick={() => { setView({ day }); setEditing(false); }}
                style={{
                  padding: "8px 14px", cursor: "pointer", fontSize: 12,
                  background: typeof view === "object" && (view as { day: string }).day === day ? "var(--panel-elevated)" : "none",
                  borderLeft: typeof view === "object" && (view as { day: string }).day === day ? "3px solid var(--accent)" : "3px solid transparent",
                }}
              >
                {day}
              </div>
            ))}
            {days.length === 0 && (
              <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>{t("workspace.memory.no_daily")}</div>
            )}

            {/* 결정사항 / 약속 / 이벤트 */}
            {section_label(t("workspace.memory.decisions"))}
            {nav_item(view === "decisions", () => setView("decisions"),
              <>{t("workspace.memory.decisions")} <span style={{ fontSize: 10, color: "var(--muted)" }}>({decisions.length})</span></>
            )}
            {nav_item(view === "promises", () => setView("promises"),
              <>{t("workspace.memory.promises")} <span style={{ fontSize: 10, color: "var(--muted)" }}>({promises.length})</span></>
            )}
            {nav_item(view === "events", () => setView("events"),
              <>{t("workspace.memory.events")} <span style={{ fontSize: 10, color: "var(--muted)" }}>({events.length})</span></>
            )}
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
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>{t("decisions.key")}</label>
          <input autoFocus value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. never_force_push" style={INPUT_STYLE} />
          <label style={{ fontSize: 11, color: "var(--muted)" }}>{t("decisions.value")}</label>
          <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="e.g. Always confirm before force-pushing" style={INPUT_STYLE} />
          <label style={{ fontSize: 11, color: "var(--muted)" }}>{t("decisions.priority")}</label>
          <select value={newPriority} onChange={(e) => setNewPriority(Number(e.target.value))} style={INPUT_STYLE}>
            <option value={0}>P0 — Critical</option>
            <option value={1}>P1 — High</option>
            <option value={2}>P2 — Medium</option>
            <option value={3}>P3 — Low</option>
          </select>
        </div>
      </Modal>

      <Modal
        open={!!deleteTarget}
        title={t("promises.confirm_delete")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void delete_promise(deleteTarget)}
        confirmLabel={t("common.delete")}
        danger
      >
        <p style={{ fontSize: 12 }}>{t("promises.delete_warning")}</p>
      </Modal>
    </>
  );
}
