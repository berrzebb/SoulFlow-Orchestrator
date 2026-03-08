import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { create_sse } from "../api/sse";
import { useToast } from "../components/toast";
import { Modal, FormModal } from "../components/modal";
import { useT } from "../i18n";
import { time_ago } from "../utils/format";
import "../styles/kanban.css";

/* ─── 타입 ─── */

interface ColumnDef { id: string; name: string; color: string; wip_limit?: number }
interface Board { board_id: string; name: string; prefix: string; columns: ColumnDef[]; scope_type: string; scope_id: string; cards?: Card[] }
interface Card {
  card_id: string; seq: number; board_id: string; title: string; description: string;
  column_id: string; position: number; priority: string; labels: string[];
  assignee?: string; created_by: string; task_id?: string;
  metadata: Record<string, unknown>; comment_count: number;
  participants?: string[];
  created_at: string; updated_at: string;
}
interface Comment { comment_id: string; card_id: string; author: string; text: string; created_at: string }
interface Relation { relation_id: string; source_card_id: string; target_card_id: string; type: string }
interface Rule {
  rule_id: string; board_id: string; trigger: string; condition: Record<string, unknown>;
  action_type: string; action_params: Record<string, unknown>; enabled: boolean; created_at: string;
}

type ViewMode = "board" | "list";
type Filter = "active" | "all" | "backlog" | "done";

const PRIORITY_ICON: Record<string, string> = { urgent: "↑↑", high: "↑", medium: "−", low: "↓", none: "" };
const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

const FILTER_KEYS: Filter[] = ["active", "all", "backlog", "done"];
const FILTER_I18N: Record<Filter, string> = {
  active: "kanban.filter_active", all: "kanban.filter_all",
  backlog: "kanban.filter_backlog", done: "kanban.filter_done",
};

/* ─── SSE 실시간 구독 ─── */

function useKanbanSSE(board_id: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!board_id) return;
    const sse = create_sse(`/api/kanban/boards/${encodeURIComponent(board_id)}/events`, {
      activity: () => {
        void qc.invalidateQueries({ queryKey: ["kanban-board", board_id] });
        void qc.invalidateQueries({ queryKey: ["kanban-boards"] });
      },
    });
    return () => sse.close();
  }, [board_id, qc]);
}

/* ─── 헬퍼 ─── */

function parse_label(label: string): { name: string; color: string } {
  const idx = label.lastIndexOf(":");
  if (idx > 0 && label[idx + 1] === "#") return { name: label.slice(0, idx), color: label.slice(idx + 1) };
  return { name: label, color: "#6b7e8f" };
}

function Participants({ list }: { list?: string[] }) {
  if (!list || list.length === 0) return null;
  const shown = list.slice(0, 3);
  const extra = list.length - shown.length;
  return (
    <span className="kanban-participants">
      {shown.map(p => <span key={p} className="kanban-participant" title={p}>{p.startsWith("user") ? "👤" : "🤖"}</span>)}
      {extra > 0 && <span className="kanban-participant kanban-participant--extra">+{extra}</span>}
    </span>
  );
}

/* ═══ Main Page ═══ */

export default function KanbanPage() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const board_id = params.get("board") || "";
  const view = (params.get("view") as ViewMode) || "board";
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [showBoardSelector, setShowBoardSelector] = useState(false);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  /* SSE 실시간 구독 */
  useKanbanSSE(board_id);

  const set_view = (v: ViewMode) => setParams((p) => { p.set("view", v); return p; }, { replace: true });
  const set_board = (id: string) => { setParams((p) => { p.set("board", id); return p; }, { replace: true }); setSelectedCard(null); };

  /* outside click / Escape → close board selector */
  useEffect(() => {
    if (!showBoardSelector) return;
    const handleClick = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) setShowBoardSelector(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowBoardSelector(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [showBoardSelector]);

  /* ─── Queries ─── */

  const { data: boards } = useQuery<Board[]>({
    queryKey: ["kanban-boards"],
    queryFn: () => api.get("/api/kanban/boards"),
    refetchInterval: 30_000,
  });

  const { data: boardDetail } = useQuery<Board>({
    queryKey: ["kanban-board", board_id],
    queryFn: () => api.get(`/api/kanban/boards/${encodeURIComponent(board_id)}`),
    enabled: !!board_id,
    refetchInterval: 15_000,
  });

  const cards = boardDetail?.cards ?? [];
  const columns = boardDetail?.columns ?? [];

  /* auto-select first board */
  useEffect(() => {
    if (!board_id && boards && boards.length > 0) set_board(boards[0]!.board_id);
  }, [boards, board_id]);

  /* ─── Filter ─── */

  const filtered_cards = (() => {
    let result = cards;
    if (filter === "active") result = result.filter(c => c.column_id !== "done");
    else if (filter === "backlog") result = result.filter(c => c.column_id === "todo");
    else if (filter === "done") result = result.filter(c => c.column_id === "done");
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => c.title.toLowerCase().includes(q) || c.card_id.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    return result;
  })();

  const refresh = () => void qc.invalidateQueries({ queryKey: ["kanban-board", board_id] });
  const refresh_boards = () => void qc.invalidateQueries({ queryKey: ["kanban-boards"] });

  /* ─── Actions ─── */

  const create_board = async (name: string, scope_type: string, scope_id: string) => {
    try {
      const board = await api.post<Board>("/api/kanban/boards", { name, scope_type, scope_id });
      refresh_boards();
      set_board(board.board_id);
      setShowCreateBoard(false);
      toast(t("kanban.board_created"), "ok");
    } catch { toast(t("kanban.create_failed"), "err"); }
  };

  /* ── delete board with Modal ── */
  const [deleteBoardTarget, setDeleteBoardTarget] = useState<Board | null>(null);

  const confirm_delete_board = async () => {
    if (!deleteBoardTarget) return;
    try {
      await api.del(`/api/kanban/boards/${encodeURIComponent(deleteBoardTarget.board_id)}`);
      refresh_boards();
      if (board_id === deleteBoardTarget.board_id) setParams((p) => { p.delete("board"); return p; }, { replace: true });
      toast(t("kanban.board_deleted"), "ok");
    } catch { toast(t("kanban.delete_failed"), "err"); }
    setDeleteBoardTarget(null);
  };

  const add_card = async (column_id: string, title: string) => {
    if (!title.trim() || !board_id) return;
    try {
      await api.post(`/api/kanban/boards/${encodeURIComponent(board_id)}/cards`, { title, column_id });
      refresh();
    } catch { toast(t("kanban.create_failed"), "err"); }
  };

  const move_card = async (card_id: string, column_id: string) => {
    try {
      await api.put(`/api/kanban/cards/${encodeURIComponent(card_id)}`, { column_id });
      refresh();
    } catch { toast(t("kanban.move_failed"), "err"); }
  };

  const update_card = async (card_id: string, data: Record<string, unknown>) => {
    try {
      await api.put(`/api/kanban/cards/${encodeURIComponent(card_id)}`, data);
      refresh();
    } catch { toast(t("kanban.update_failed"), "err"); }
  };

  const delete_card = async (card_id: string) => {
    try {
      await api.del(`/api/kanban/cards/${encodeURIComponent(card_id)}`);
      if (selectedCard === card_id) setSelectedCard(null);
      refresh();
      toast(t("kanban.card_deleted"), "ok");
    } catch { toast(t("kanban.delete_failed"), "err"); }
  };

  /* ─── No board ─── */

  if (!board_id && (!boards || boards.length === 0)) {
    return (
      <div className="page">
        <div className="kanban-empty">
          <div className="kanban-empty__icon">📋</div>
          <div>{t("kanban.no_boards")}</div>
          <button className="btn btn--accent kanban-empty__btn" onClick={() => setShowCreateBoard(true)}>
            + {t("kanban.new_board")}
          </button>
        </div>
        <CreateBoardModal open={showCreateBoard} onClose={() => setShowCreateBoard(false)} onCreate={create_board} />
      </div>
    );
  }

  /* ─── Render ─── */

  return (
    <div className="kanban-page">
      {/* Header */}
      <div className="kanban-header">
        <div className="board-selector" ref={selectorRef}>
          <button className="kanban-header__title" onClick={() => setShowBoardSelector(!showBoardSelector)}
            aria-expanded={showBoardSelector} aria-haspopup="listbox">
            {boardDetail?.name ?? "..."} ▾
          </button>
          {showBoardSelector && boards && (
            <div className="board-selector__dropdown" role="listbox">
              {boards.map(b => (
                <div key={b.board_id} className={`board-selector__item ${b.board_id === board_id ? "board-selector__item--active" : ""}`} role="option" aria-selected={b.board_id === board_id}>
                  <button className="board-selector__item-name"
                    onClick={() => { set_board(b.board_id); setShowBoardSelector(false); }}>
                    {b.name}
                    <span className="board-selector__item-scope">{b.scope_type}:{b.scope_id}</span>
                  </button>
                  <button className="board-selector__item-del" title={t("kanban.delete_board")}
                    aria-label={t("kanban.delete_board")}
                    onClick={(e) => { e.stopPropagation(); setDeleteBoardTarget(b); }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="kanban-header__actions">
          <div className="view-toggle" role="tablist">
            <button className={`view-toggle__btn ${view === "board" ? "view-toggle__btn--active" : ""}`}
              role="tab" aria-selected={view === "board"} onClick={() => set_view("board")}>{t("kanban.view_board")}</button>
            <button className={`view-toggle__btn ${view === "list" ? "view-toggle__btn--active" : ""}`}
              role="tab" aria-selected={view === "list"} onClick={() => set_view("list")}>{t("kanban.view_list")}</button>
          </div>
          <div className="kanban-filters">
            {FILTER_KEYS.map(f => (
              <button key={f} className={`kanban-filters__btn ${filter === f ? "kanban-filters__btn--active" : ""}`} onClick={() => setFilter(f)}>
                {t(FILTER_I18N[f])}
              </button>
            ))}
          </div>
          <input className="kanban-search" placeholder={t("kanban.search")} value={search} onChange={e => setSearch(e.target.value)} aria-label={t("kanban.search")} />
          {board_id && <button className={`btn btn--sm ${showRules ? "btn--accent" : ""}`} onClick={() => setShowRules(!showRules)}>{t("kanban.rules")}</button>}
          <button className="btn btn--accent btn--sm" onClick={() => setShowCreateBoard(true)}>+ {t("kanban.new_board")}</button>
        </div>
      </div>
      <CreateBoardModal open={showCreateBoard} onClose={() => setShowCreateBoard(false)} onCreate={create_board} />

      {/* Delete board confirmation modal */}
      <Modal open={!!deleteBoardTarget} title={t("kanban.delete_board")} danger
        onClose={() => setDeleteBoardTarget(null)} onConfirm={confirm_delete_board}
        confirmLabel={t("kanban.delete_board")}>
        <p>{deleteBoardTarget ? t("kanban.confirm_delete_board", { name: deleteBoardTarget.name }) : ""}</p>
      </Modal>

      {/* Rules panel */}
      {showRules && board_id && <RulesPanel board_id={board_id} onClose={() => setShowRules(false)} />}

      {/* Body */}
      <div className="kanban-body">
        {view === "board"
          ? <BoardView columns={columns} cards={filtered_cards} selectedCard={selectedCard} onSelect={setSelectedCard} onAddCard={add_card} onMoveCard={move_card} />
          : <ListView cards={filtered_cards} columns={columns} selectedCard={selectedCard} onSelect={setSelectedCard} />
        }

        {selectedCard && (
          <CardDetailPanel card_id={selectedCard} board_id={board_id} columns={columns}
            onClose={() => setSelectedCard(null)} onUpdate={update_card} onMove={move_card} onDelete={delete_card}
            onSelectCard={setSelectedCard} />
        )}
      </div>
    </div>
  );
}

/* ═══ Board View ═══ */

function BoardView({ columns, cards, selectedCard, onSelect, onAddCard, onMoveCard }: {
  columns: ColumnDef[]; cards: Card[]; selectedCard: string | null;
  onSelect: (id: string) => void; onAddCard: (col: string, title: string) => void;
  onMoveCard: (card_id: string, col: string) => void;
}) {
  return (
    <div className="kanban-board">
      {columns.map(col => {
        const col_cards = cards.filter(c => c.column_id === col.id).sort((a, b) => a.position - b.position);
        return (
          <KanbanColumn key={col.id} column={col} cards={col_cards} selectedCard={selectedCard}
            onSelect={onSelect} onAddCard={(title) => onAddCard(col.id, title)}
            onDrop={(card_id) => onMoveCard(card_id, col.id)} />
        );
      })}
    </div>
  );
}

function KanbanColumn({ column, cards, selectedCard, onSelect, onAddCard, onDrop }: {
  column: ColumnDef; cards: Card[]; selectedCard: string | null;
  onSelect: (id: string) => void; onAddCard: (title: string) => void;
  onDrop: (card_id: string) => void;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handle_add = () => {
    if (newTitle.trim()) { onAddCard(newTitle.trim()); setNewTitle(""); setAdding(false); }
  };

  const over_wip = !!(column.wip_limit && cards.length > column.wip_limit);

  return (
    <div className={`kanban-col${dragOver ? " kanban-col--drag-over" : ""}${over_wip ? " kanban-col--over-wip" : ""}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const id = e.dataTransfer.getData("text/card-id"); if (id) onDrop(id); }}>
      <div className="kanban-col__header">
        <span className="kanban-col__dot" style={{ background: column.color }} />
        {column.name}
        <span className={`kanban-col__count${over_wip ? " kanban-col__count--over" : ""}`}>
          {cards.length}{column.wip_limit ? `/${column.wip_limit}` : ""}
        </span>
        <button className="kanban-col__add" onClick={() => setAdding(true)} aria-label={`${column.name} add card`}>+</button>
      </div>
      <div className="kanban-col__cards">
        {adding && (
          <div className="kanban-inline-add">
            <input autoFocus placeholder={t("kanban.issue_title_placeholder")} value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handle_add(); if (e.key === "Escape") { setAdding(false); setNewTitle(""); } }}
              onBlur={() => { if (newTitle.trim()) handle_add(); else setAdding(false); }} />
          </div>
        )}
        {cards.map(card => (
          <KanbanCardItem key={card.card_id} card={card} selected={card.card_id === selectedCard} onClick={() => onSelect(card.card_id)} />
        ))}
        {cards.length === 0 && !adding && (
          <div className="kanban-col__empty">{t("kanban.empty_column")}</div>
        )}
      </div>
    </div>
  );
}

function KanbanCardItem({ card, selected, onClick }: { card: Card; selected: boolean; onClick: () => void }) {
  const subtask_count = (card.metadata?.subtask_total as number) ?? 0;
  const subtask_done = (card.metadata?.subtask_done as number) ?? 0;

  return (
    <div className={`kanban-card ${selected ? "kanban-card--selected" : ""}`} onClick={onClick}
      role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      draggable onDragStart={(e) => { e.dataTransfer.setData("text/card-id", card.card_id); e.dataTransfer.effectAllowed = "move"; }}>
      <div className="kanban-card__id">{card.card_id}</div>
      <div className="kanban-card__title" title={card.title}>{card.title}</div>
      {card.description && <div className="kanban-card__desc" title={card.description}>{card.description}</div>}
      <div className="kanban-card__footer">
        {card.labels.length > 0 && (
          <div className="kanban-card__labels">
            {card.labels.map(l => { const { name, color } = parse_label(l); return (
              <span key={l} className="kanban-label"><span className="kanban-label__dot" style={{ background: color }} />{name}</span>
            ); })}
          </div>
        )}
        <div className="kanban-card__meta">
          {card.priority !== "none" && (
            <span className={`kanban-card__priority kanban-card__priority--${card.priority}`}>{PRIORITY_ICON[card.priority]}</span>
          )}
          {subtask_count > 0 && <span className="kanban-card__subtask-badge">{subtask_done}/{subtask_count}</span>}
          {card.comment_count > 0 && <span>💬{card.comment_count}</span>}
          <Participants list={card.participants} />
        </div>
      </div>
    </div>
  );
}

/* ═══ List View ═══ */

function ListView({ cards, columns, selectedCard, onSelect }: {
  cards: Card[]; columns: ColumnDef[]; selectedCard: string | null; onSelect: (id: string) => void;
}) {
  const t = useT();
  const [sortKey, setSortKey] = useState<"priority" | "updated_at" | "card_id">("priority");
  const [sortAsc, setSortAsc] = useState(true);

  const col_map = new Map(columns.map(c => [c.id, c]));

  const sorted = (() => {
    const arr = [...cards];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "priority") cmp = (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
      else if (sortKey === "updated_at") cmp = b.updated_at.localeCompare(a.updated_at);
      else cmp = a.card_id.localeCompare(b.card_id);
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  })();

  const toggle_sort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sort_indicator = (key: typeof sortKey) => sortKey === key ? (sortAsc ? " ▲" : " ▼") : "";

  return (
    <div className="kanban-list">
      <table>
        <thead>
          <tr>
            <th role="button" tabIndex={0} onClick={() => toggle_sort("priority")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle_sort("priority"); } }}>{t("kanban.priority")}{sort_indicator("priority")}</th>
            <th role="button" tabIndex={0} onClick={() => toggle_sort("card_id")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle_sort("card_id"); } }}>{t("kanban.id")}{sort_indicator("card_id")}</th>
            <th>{t("kanban.title")}</th>
            <th>{t("kanban.status")}</th>
            <th>{t("kanban.assignee")}</th>
            <th role="button" tabIndex={0} onClick={() => toggle_sort("updated_at")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle_sort("updated_at"); } }}>{t("kanban.updated")}{sort_indicator("updated_at")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(card => {
            const col = col_map.get(card.column_id);
            return (
              <tr key={card.card_id} className={card.card_id === selectedCard ? "kanban-list__row--selected" : ""} tabIndex={0} onClick={() => onSelect(card.card_id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(card.card_id); } }}>
                <td><span className={`kanban-card__priority kanban-card__priority--${card.priority}`}>{PRIORITY_ICON[card.priority] || "—"}</span></td>
                <td className="kanban-list__cell--id">{card.card_id}</td>
                <td>{card.title}</td>
                <td>
                  <span className="kanban-list__status">
                    <span className="kanban-col__dot" style={{ background: col?.color ?? "#6b7e8f" }} />
                    {col?.name ?? card.column_id}
                  </span>
                </td>
                <td className="kanban-list__cell--muted">{card.assignee ?? "—"}</td>
                <td className="kanban-list__cell--muted kanban-list__cell--xs">{time_ago(card.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══ Card Detail Panel ═══ */

function CardDetailPanel({ card_id, board_id, columns, onClose, onUpdate, onMove, onDelete, onSelectCard }: {
  card_id: string; board_id: string; columns: ColumnDef[];
  onClose: () => void; onUpdate: (id: string, data: Record<string, unknown>) => void;
  onMove: (id: string, col: string) => void; onDelete: (id: string) => void;
  onSelectCard: (id: string) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(false);

  const { data: card } = useQuery<Card>({
    queryKey: ["kanban-card", card_id],
    queryFn: async () => {
      const boards_data = await api.get<Board>(`/api/kanban/boards/${encodeURIComponent(board_id)}`);
      const found = boards_data.cards?.find(c => c.card_id === card_id);
      if (!found) throw new Error("Card not found");
      return found;
    },
    enabled: !!card_id,
    refetchInterval: 15_000,
  });

  const { data: comments } = useQuery<Comment[]>({
    queryKey: ["kanban-comments", card_id],
    queryFn: () => api.get(`/api/kanban/cards/${encodeURIComponent(card_id)}/comments`),
    enabled: !!card_id,
    refetchInterval: 15_000,
  });

  const { data: relations } = useQuery<Relation[]>({
    queryKey: ["kanban-relations", card_id],
    queryFn: () => api.get(`/api/kanban/cards/${encodeURIComponent(card_id)}/relations`),
    enabled: !!card_id,
  });

  const { data: subtasks } = useQuery<Card[]>({
    queryKey: ["kanban-subtasks", card_id],
    queryFn: () => api.get(`/api/kanban/cards/${encodeURIComponent(card_id)}/subtasks`),
    enabled: !!card_id,
    refetchInterval: 15_000,
  });

  const qc = useQueryClient();

  const add_comment = async () => {
    if (!commentText.trim()) return;
    try {
      await api.post(`/api/kanban/cards/${encodeURIComponent(card_id)}/comments`, { text: commentText.trim() });
      setCommentText("");
      void qc.invalidateQueries({ queryKey: ["kanban-comments", card_id] });
    } catch { toast(t("kanban.comment_failed"), "err"); }
  };

  if (!card) return <div className="kanban-detail"><div className="kanban-detail__loading">{t("kanban.loading")}</div></div>;

  const col = columns.find(c => c.id === card.column_id);
  const meta = card.metadata;
  const non_subtask_relations = (relations ?? []).filter(r => r.type !== "parent_of" && r.type !== "child_of");
  const done_count = (subtasks ?? []).filter(s => s.column_id === "done").length;
  const total_count = subtasks?.length ?? 0;

  return (
    <div className="kanban-detail">
      <div className="kanban-detail__header">
        <span className="kanban-detail__card-id">{card.card_id}</span>
        <button className="kanban-detail__close" onClick={onClose} aria-label={t("common.close")}>✕</button>
      </div>
      <div className="kanban-detail__body">
        {/* Meta */}
        <div className="kanban-detail__meta">
          <span className="kanban-detail__badge">
            <span className="kanban-col__dot" style={{ background: col?.color ?? "#6b7e8f" }} />
            {col?.name ?? card.column_id}
          </span>
          <select className="kanban-detail__select" value={card.priority} aria-label={t("kanban.priority")}
            onChange={(e) => onUpdate(card.card_id, { priority: e.target.value })}>
            {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_ICON[p]} {p}</option>)}
          </select>
          <input key={`assignee-${card.updated_at}`} className="kanban-detail__assignee-input" defaultValue={card.assignee ?? ""} placeholder={t("kanban.assignee_placeholder")} aria-label={t("kanban.assignee")}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (card.assignee ?? "")) onUpdate(card.card_id, { assignee: v || null }); }} />
          <span className="kanban-detail__badge">{card.created_by}</span>
          <Participants list={card.participants} />
        </div>

        {/* Column selector */}
        <div className="kanban-detail__col-selector">
          {columns.map(c => (
            <button key={c.id} className={`kanban-filters__btn ${c.id === card.column_id ? "kanban-filters__btn--active" : ""}`}
              onClick={() => onMove(card.card_id, c.id)}>
              {c.name}
            </button>
          ))}
        </div>

        {/* Title */}
        <input key={`title-${card.updated_at}`} className="kanban-detail__title" defaultValue={card.title}
          onBlur={(e) => { if (e.target.value !== card.title) onUpdate(card.card_id, { title: e.target.value }); }} />

        {/* Labels */}
        <div className="kanban-card__labels kanban-detail__labels">
          {card.labels.map(l => { const { name, color } = parse_label(l); return (
            <span key={l} className="kanban-label">
              <span className="kanban-label__dot" style={{ background: color }} />{name}
              <button className="kanban-label__remove" aria-label={`Remove ${name}`}
                onClick={() => onUpdate(card.card_id, { labels: card.labels.filter(x => x !== l) })}>✕</button>
            </span>
          ); })}
          <input className="kanban-detail__label-input" placeholder={t("kanban.label_placeholder")} size={10}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v && !card.labels.includes(v)) { onUpdate(card.card_id, { labels: [...card.labels, v] }); (e.target as HTMLInputElement).value = ""; } } }} />
        </div>

        {/* Description */}
        <textarea key={`desc-${card.updated_at}`} className="kanban-detail__desc" defaultValue={card.description} placeholder={t("kanban.no_description")}
          onBlur={(e) => { if (e.target.value !== card.description) onUpdate(card.card_id, { description: e.target.value }); }} />

        {/* Subtasks */}
        {total_count > 0 && (
          <div className="kanban-detail__section">
            <div className="kanban-detail__section-title">{t("kanban.subtasks")} ({done_count}/{total_count})</div>
            <div className="kanban-subtasks__progress">
              <div className="kanban-subtasks__progress-bar" style={{ width: `${total_count > 0 ? (done_count / total_count) * 100 : 0}%` }} />
            </div>
            {(subtasks ?? []).map(s => (
              <div key={s.card_id} className={`kanban-subtask-item ${s.column_id === "done" ? "kanban-subtask-item--done" : ""}`}
                onClick={() => onSelectCard(s.card_id)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectCard(s.card_id); } }}>
                <span>{s.column_id === "done" ? "☑" : "☐"}</span>
                <span className="kanban-subtask-item__id">{s.card_id}</span>
                <span>{s.title}</span>
                <span className="kanban-subtask-item__col">{s.column_id}</span>
              </div>
            ))}
          </div>
        )}

        {/* Workspaces (git metadata) */}
        {!!(meta?.branch || meta?.pr_url || meta?.files) && (
          <div className="kanban-detail__section">
            <div className="kanban-detail__section-title">{t("kanban.workspaces")}</div>
            <div className="kanban-workspace">
              {!!meta.branch && <div className="kanban-workspace__stat">🔀 {String(meta.branch)}</div>}
              {!!meta.pr_url && <div className="kanban-workspace__stat"><a href={String(meta.pr_url)} target="_blank" rel="noopener" className="kanban-workspace__link">PR #{String(meta.pr_number ?? "")}</a></div>}
              {Array.isArray(meta.files) && <div className="kanban-workspace__stat">📁 {t("kanban.files_count", { count: meta.files.length })}</div>}
              {typeof meta.lines_added === "number" && <div className="kanban-workspace__stat kanban-workspace__stat--added">+{Number(meta.lines_added)}</div>}
              {typeof meta.lines_removed === "number" && <div className="kanban-workspace__stat kanban-workspace__stat--removed">-{Number(meta.lines_removed)}</div>}
            </div>
          </div>
        )}

        {/* Relations */}
        {non_subtask_relations.length > 0 && (
          <div className="kanban-detail__section">
            <div className="kanban-detail__section-title">{t("kanban.relationships")}</div>
            {non_subtask_relations.map(r => {
              const target = r.source_card_id === card.card_id ? r.target_card_id : r.source_card_id;
              return (
                <div key={r.relation_id} className="kanban-relation">
                  <span className="kanban-relation__type">{r.type}</span>
                  <button className="kanban-relation__target" onClick={() => onSelectCard(target)}>{target}</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Comments */}
        <div className="kanban-detail__section">
          <div className="kanban-detail__section-title">{t("kanban.comments")} ({comments?.length ?? 0})</div>
          {(comments ?? []).map(c => (
            <div key={c.comment_id} className="kanban-comment">
              <div className="kanban-comment__author">{c.author}</div>
              <div className="kanban-comment__text">{c.text}</div>
              <div className="kanban-comment__time">{time_ago(c.created_at)}</div>
            </div>
          ))}
          <div className="kanban-comment-input">
            <textarea placeholder={t("kanban.add_comment_hint")} value={commentText} onChange={e => setCommentText(e.target.value)}
              aria-label={t("kanban.add_comment")}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); add_comment(); } }} />
            <button onClick={add_comment} disabled={!commentText.trim()}>{t("kanban.post")}</button>
          </div>
        </div>

        {/* Delete */}
        <button className="kanban-detail__delete" onClick={() => setConfirmDeleteCard(true)}>
          {t("kanban.delete_card")}
        </button>
        <Modal open={confirmDeleteCard} title={t("kanban.delete_card")} danger
          onClose={() => setConfirmDeleteCard(false)}
          onConfirm={() => { setConfirmDeleteCard(false); onDelete(card.card_id); }}
          confirmLabel={t("kanban.delete_card")}>
          <p>{t("kanban.confirm_delete_card", { id: card.card_id })}</p>
        </Modal>
      </div>
    </div>
  );
}

/* ═══ Create Board Modal ═══ */

const SCOPE_TYPES = ["workflow", "channel", "session"] as const;

function CreateBoardModal({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void;
  onCreate: (name: string, scope_type: string, scope_id: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState<string>("workflow");
  const [scopeId, setScopeId] = useState("");

  const reset = () => { setName(""); setScopeType("workflow"); setScopeId(""); };

  const handle_submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !scopeId.trim()) return;
    onCreate(name.trim(), scopeType, scopeId.trim());
    reset();
  };

  return (
    <FormModal open={open} title={t("kanban.new_board")} onClose={() => { onClose(); reset(); }}
      onSubmit={handle_submit} submitLabel={t("kanban.create_board")} submitDisabled={!name.trim() || !scopeId.trim()}>
      <label className="form-label">{t("kanban.board_name")}</label>
      <input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus
        placeholder="e.g. Sprint 1, My Project" />

      <label className="form-label kanban-form__label--mt">{t("kanban.scope_type")}</label>
      <select className="form-input" value={scopeType} onChange={e => setScopeType(e.target.value)}>
        {SCOPE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <label className="form-label kanban-form__label--mt">{t("kanban.scope_id")}</label>
      <input className="form-input" value={scopeId} onChange={e => setScopeId(e.target.value)}
        placeholder="e.g. my-workflow, #general" onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && scopeId.trim()) handle_submit(e as unknown as React.FormEvent); }} />
    </FormModal>
  );
}

/* ═══ Rules Panel ═══ */

const TRIGGER_OPTIONS = ["card_moved", "subtasks_done", "card_stale"] as const;
const ACTION_TYPE_OPTIONS = ["move_card", "assign", "add_label", "comment", "run_workflow", "create_task"] as const;

function RulesPanel({ board_id, onClose }: { board_id: string; onClose: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data: rules } = useQuery<Rule[]>({
    queryKey: ["kanban-rules", board_id],
    queryFn: () => api.get(`/api/kanban/boards/${encodeURIComponent(board_id)}/rules`),
    enabled: !!board_id,
  });

  const toggle_rule = async (rule: Rule) => {
    try {
      await api.put(`/api/kanban/rules/${encodeURIComponent(rule.rule_id)}`, { enabled: !rule.enabled });
      void qc.invalidateQueries({ queryKey: ["kanban-rules", board_id] });
    } catch { toast(t("kanban.update_failed"), "err"); }
  };

  const delete_rule = async (rule_id: string) => {
    try {
      await api.del(`/api/kanban/rules/${encodeURIComponent(rule_id)}`);
      void qc.invalidateQueries({ queryKey: ["kanban-rules", board_id] });
      toast(t("kanban.rule_deleted"), "ok");
    } catch { toast(t("kanban.delete_failed"), "err"); }
  };

  return (
    <div className="kanban-rules">
      <div className="kanban-rules__header">
        <span className="kanban-rules__title">{t("kanban.rules")}</span>
        <button className="btn btn--accent btn--sm" onClick={() => setShowCreate(true)}>+ {t("kanban.new_rule")}</button>
        <button className="kanban-detail__close" onClick={onClose} aria-label={t("common.close")}>✕</button>
      </div>
      <div className="kanban-rules__list">
        {(!rules || rules.length === 0) && <div className="kanban-rules__empty">{t("kanban.no_rules")}</div>}
        {(rules ?? []).map(rule => (
          <div key={rule.rule_id} className={`kanban-rules__item ${rule.enabled ? "" : "kanban-rules__item--disabled"}`}>
            <label className="kanban-rules__toggle">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggle_rule(rule)} />
            </label>
            <div className="kanban-rules__info">
              <span className="kanban-rules__trigger">{rule.trigger}</span>
              <span className="kanban-rules__arrow">→</span>
              <span className="kanban-rules__action">{rule.action_type}</span>
              {Object.keys(rule.condition).length > 0 && (
                <span className="kanban-rules__condition" title={JSON.stringify(rule.condition)}>
                  {Object.entries(rule.condition).map(([k, v]) => `${k}=${v}`).join(", ")}
                </span>
              )}
            </div>
            <button className="kanban-rules__delete" onClick={() => delete_rule(rule.rule_id)} aria-label={t("kanban.delete_rule")}>✕</button>
          </div>
        ))}
      </div>
      {showCreate && <CreateRuleForm board_id={board_id} onClose={() => setShowCreate(false)} onCreated={() => {
        setShowCreate(false);
        void qc.invalidateQueries({ queryKey: ["kanban-rules", board_id] });
      }} />}
    </div>
  );
}

function CreateRuleForm({ board_id, onClose, onCreated }: { board_id: string; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [trigger, setTrigger] = useState<string>("card_moved");
  const [actionType, setActionType] = useState<string>("move_card");
  const [conditionStr, setConditionStr] = useState("{}");
  const [paramsStr, setParamsStr] = useState("{}");

  const handle_submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let condition: Record<string, unknown>;
    let action_params: Record<string, unknown>;
    try { condition = JSON.parse(conditionStr); } catch { toast(t("kanban.invalid_json"), "err"); return; }
    try { action_params = JSON.parse(paramsStr); } catch { toast(t("kanban.invalid_json"), "err"); return; }
    try {
      await api.post(`/api/kanban/boards/${encodeURIComponent(board_id)}/rules`, { trigger, action_type: actionType, condition, action_params });
      toast(t("kanban.rule_created"), "ok");
      onCreated();
    } catch { toast(t("kanban.create_failed"), "err"); }
  };

  return (
    <form className="kanban-rules__form" onSubmit={handle_submit}>
      <label className="form-label">{t("kanban.trigger")}</label>
      <select autoFocus className="form-input" value={trigger} onChange={e => setTrigger(e.target.value)}>
        {TRIGGER_OPTIONS.map(tr => <option key={tr} value={tr}>{tr}</option>)}
      </select>

      <label className="form-label kanban-form__label--mt">{t("kanban.action_type")}</label>
      <select className="form-input" value={actionType} onChange={e => setActionType(e.target.value)}>
        {ACTION_TYPE_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
      </select>

      <label className="form-label kanban-form__label--mt">{t("kanban.condition")}</label>
      <textarea className="form-input kanban-rules__json" value={conditionStr} onChange={e => setConditionStr(e.target.value)}
        placeholder='{"to_column": "done"}' />

      <label className="form-label kanban-form__label--mt">{t("kanban.action_params")}</label>
      <textarea className="form-input kanban-rules__json" value={paramsStr} onChange={e => setParamsStr(e.target.value)}
        placeholder='{"column_id": "done"}' />

      <div className="kanban-rules__form-actions">
        <button type="submit" className="btn btn--accent btn--sm">{t("kanban.create_rule")}</button>
        <button type="button" className="btn btn--sm" onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
