/** WBS (Work Breakdown Structure) 페이지 — 칸반 카드를 parent_id 계층으로 트리 렌더링. */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { useT } from "../i18n";
import { time_ago } from "../utils/format";
import { useAsyncAction } from "../hooks/use-async-action";
import "../styles/wbs.css";

/* ─── 타입 ─── */

interface ColumnDef { id: string; name: string; color: string }
interface Board { board_id: string; name: string; prefix: string; columns: ColumnDef[]; scope_type: string; scope_id: string; cards?: Card[] }
interface Card {
  card_id: string; seq: number; board_id: string; title: string; description: string;
  column_id: string; position: number; priority: string; labels: string[];
  assignee?: string; created_by: string; parent_id?: string;
  metadata: Record<string, unknown>; comment_count: number;
  created_at: string; updated_at: string;
}

interface WbsNode {
  card: Card;
  level: number;
  wbs_code: string;
  children: WbsNode[];
  progress: number; // 0-100 (자식 done/total)
}

/* ─── 트리 빌더 ─── */

function build_wbs_tree(cards: Card[], columns: ColumnDef[]): WbsNode[] {
  const done_cols = new Set(["done"]);
  // 칸반 컬럼 중 마지막 컬럼을 done으로 추가 인식
  const last_col = columns.at(-1);
  if (last_col) done_cols.add(last_col.id);

  const by_id = new Map<string, Card>(cards.map(c => [c.card_id, c]));
  const children_of = new Map<string, Card[]>();

  for (const card of cards) {
    const pid = card.parent_id;
    const parent_exists = pid ? by_id.has(pid) : false;
    const key = (parent_exists && pid) ? pid : "__root__";
    if (!children_of.has(key)) children_of.set(key, []);
    children_of.get(key)!.push(card);
  }

  function make_node(card: Card, level: number, wbs_prefix: string, index: number): WbsNode {
    const wbs_code = wbs_prefix ? `${wbs_prefix}.${index}` : String(index);
    const child_cards = children_of.get(card.card_id) ?? [];
    const children = child_cards
      .sort((a, b) => a.position - b.position || a.seq - b.seq)
      .map((c, i) => make_node(c, level + 1, wbs_code, i + 1));

    // 자식이 있으면 자식 기준 진도율, 없으면 직접 상태 기반
    let progress: number;
    if (children.length > 0) {
      const done_count = count_done(children, done_cols);
      const total = count_all(children);
      progress = total > 0 ? Math.round((done_count / total) * 100) : 0;
    } else {
      progress = done_cols.has(card.column_id) ? 100 : 0;
    }

    return { card, level, wbs_code, children, progress };
  }

  const roots = (children_of.get("__root__") ?? [])
    .sort((a, b) => a.position - b.position || a.seq - b.seq);

  return roots.map((c, i) => make_node(c, 0, "", i + 1));
}

function count_done(nodes: WbsNode[], done_cols: Set<string>): number {
  return nodes.reduce((acc, n) => {
    const self = done_cols.has(n.card.column_id) ? 1 : 0;
    return acc + self + (n.children.length > 0 ? count_done(n.children, done_cols) : 0);
  }, 0);
}

function count_all(nodes: WbsNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + count_all(n.children), 0);
}

function flatten(nodes: WbsNode[]): WbsNode[] {
  const result: WbsNode[] = [];
  for (const n of nodes) {
    result.push(n);
    result.push(...flatten(n.children));
  }
  return result;
}

/* ─── 상수 ─── */

const PRIORITY_ICON: Record<string, string> = { urgent: "↑↑", high: "↑", medium: "−", low: "↓", none: "" };
const STATUS_COLOR: Record<string, string> = {
  todo: "#8b98a4",
  in_progress: "#3498db",
  in_review: "#f39c12",
  done: "#27ae60",
};
const LEVEL_COLORS = ["#6366f1", "#3b82f6", "#06b6d4", "#10b981"];

/* ─── 컴포넌트 ─── */

function ProgressBar({ value }: { value: number }) {
  const color = value === 100 ? "#27ae60" : value > 50 ? "#3498db" : "#8b98a4";
  return (
    <div className="wbs-progress" title={`${value}%`}>
      <div className="wbs-progress__bar" style={{ width: `${value}%`, background: color }} />
      <span className="wbs-progress__label">{value}%</span>
    </div>
  );
}

function WbsRow({ node, selected, on_select }: {
  node: WbsNode;
  selected: boolean;
  on_select: (id: string) => void;
}) {
  const { card, level, wbs_code, progress } = node;
  const indent = level * 20;
  const level_color = LEVEL_COLORS[Math.min(level, LEVEL_COLORS.length - 1)];

  return (
    <tr
      className={`wbs-row wbs-row--l${level}${selected ? " wbs-row--selected" : ""}`}
      onClick={() => on_select(card.card_id)}
    >
      <td className="wbs-cell wbs-cell--code">
        <span className="wbs-code" style={{ color: level_color }}>{wbs_code}</span>
      </td>
      <td className="wbs-cell wbs-cell--title">
        <span className="wbs-indent" style={{ paddingLeft: `${indent}px` }}>
          {level > 0 && <span className="wbs-indent__connector">└</span>}
          <span className="wbs-title">{card.title}</span>
          <span className="wbs-id">{card.card_id}</span>
        </span>
      </td>
      <td className="wbs-cell wbs-cell--status">
        <span
          className="wbs-badge"
          style={{ background: STATUS_COLOR[card.column_id] ?? "#8b98a4" }}
        >
          {card.column_id}
        </span>
      </td>
      <td className="wbs-cell wbs-cell--priority">
        {card.priority !== "none" && (
          <span className={`wbs-priority wbs-priority--${card.priority}`}>
            {PRIORITY_ICON[card.priority]} {card.priority}
          </span>
        )}
      </td>
      <td className="wbs-cell wbs-cell--assignee">
        <span className="wbs-assignee">{card.assignee ?? "—"}</span>
      </td>
      <td className="wbs-cell wbs-cell--progress">
        <ProgressBar value={progress} />
      </td>
      <td className="wbs-cell wbs-cell--updated">
        <span className="wbs-muted">{time_ago(card.updated_at)}</span>
      </td>
    </tr>
  );
}

/* ─── 카드 상세 패널 ─── */

function WbsDetailPanel({ card, board_id, columns, on_close, on_update }: {
  card: Card;
  board_id: string;
  columns: ColumnDef[];
  on_close: () => void;
  on_update: () => void;
}) {
  const t = useT();
  const run_action = useAsyncAction();
  const [comment, set_comment] = useState("");
  const card_id = card.card_id;

  const { data: comments } = useQuery<Array<{ comment_id: string; author: string; text: string; created_at: string }>>({
    queryKey: ["wbs-comments", card_id],
    queryFn: () => api.get(`/api/kanban/cards/${encodeURIComponent(card_id)}/comments`),
    enabled: !!card_id,
  });

  const move_to = (col_id: string) =>
    run_action(
      () => api.put(`/api/kanban/cards/${encodeURIComponent(card_id)}`, { column_id: col_id }).then(on_update),
      undefined,
      t("common.save_failed"),
    );

  const post_comment = () => {
    if (!comment.trim()) return Promise.resolve();
    return run_action(
      () => api.post(`/api/kanban/cards/${encodeURIComponent(card_id)}/comments`, { text: comment, author: "user:dashboard" })
        .then(() => { set_comment(""); on_update(); }),
      undefined,
      t("common.save_failed"),
    );
  };

  return (
    <aside className="wbs-detail">
      <div className="wbs-detail__header">
        <span className="wbs-detail__id">{card_id}</span>
        <button className="wbs-detail__close btn btn--xs" onClick={on_close}>✕</button>
      </div>
      <h2 className="wbs-detail__title">{card.title}</h2>
      {card.description && <p className="wbs-detail__desc">{card.description}</p>}
      <div className="wbs-detail__meta">
        <label className="wbs-detail__label">{t("kanban.status")}</label>
        <div className="wbs-detail__cols">
          {columns.map(col => (
            <button
              key={col.id}
              className={`wbs-col-btn${card.column_id === col.id ? " wbs-col-btn--active" : ""}`}
              style={{ borderColor: card.column_id === col.id ? col.color : undefined }}
              onClick={() => void move_to(col.id)}
            >
              {col.name}
            </button>
          ))}
        </div>
      </div>
      <div className="wbs-detail__meta">
        <span className="wbs-detail__label">{t("kanban.priority")}</span>
        <span className={`wbs-priority wbs-priority--${card.priority}`}>
          {PRIORITY_ICON[card.priority]} {card.priority}
        </span>
      </div>
      {card.assignee && (
        <div className="wbs-detail__meta">
          <span className="wbs-detail__label">{t("kanban.assignee")}</span>
          <span>{card.assignee}</span>
        </div>
      )}
      <div className="wbs-detail__meta">
        <span className="wbs-detail__label">{t("kanban.view_in_kanban")}</span>
        <Link className="wbs-link" to={`/kanban?board=${board_id}`}>{t("nav.kanban")}</Link>
      </div>

      <div className="wbs-detail__comments">
        <div className="wbs-detail__label">{t("kanban.comments")}</div>
        {(comments ?? []).map(c => (
          <div key={c.comment_id} className="wbs-comment">
            <span className="wbs-comment__author">{c.author}</span>
            <span className="wbs-comment__text">{c.text}</span>
            <span className="wbs-muted">{time_ago(c.created_at)}</span>
          </div>
        ))}
        <div className="wbs-detail__comment-form">
          <textarea
            className="wbs-detail__comment-input"
            value={comment}
            onChange={e => set_comment(e.target.value)}
            placeholder={t("kanban.add_comment_hint")}
            rows={2}
            onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) void post_comment(); }}
          />
          <button className="btn btn--xs btn--accent" onClick={() => void post_comment()}>
            {t("kanban.add_comment")}
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ─── 메인 페이지 ─── */

export default function WbsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const board_id_param = params.get("board") || "";
  const [selected_card, set_selected_card] = useState<string | null>(null);
  const [search, set_search] = useState("");
  const [show_done, set_show_done] = useState(true);

  const { data: boards } = useQuery<Board[]>({
    queryKey: ["kanban-boards"],
    queryFn: () => api.get("/api/kanban/boards"),
    refetchInterval: 30_000,
  });

  const board_id = board_id_param || boards?.[0]?.board_id || "";
  const set_board = (id: string) => setParams(p => { p.set("board", id); return p; }, { replace: true });

  const { data: board_detail, isPending } = useQuery<Board>({
    queryKey: ["kanban-board", board_id],
    queryFn: () => api.get(`/api/kanban/boards/${encodeURIComponent(board_id)}`),
    enabled: !!board_id,
    refetchInterval: 15_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["kanban-board", board_id] });

  const all_cards = board_detail?.cards ?? [];
  const columns = board_detail?.columns ?? [];

  /* 검색 필터 */
  const filtered_cards = search
    ? all_cards.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.card_id.toLowerCase().includes(search.toLowerCase()),
      )
    : all_cards;

  /* done 필터 — done 상태를 숨기되 자식 계층이 있는 경우 부모는 유지 */
  const visible_cards = show_done
    ? filtered_cards
    : filtered_cards.filter(c => c.column_id !== "done");

  const tree = build_wbs_tree(visible_cards, columns);
  const flat = flatten(tree);

  if (!board_id && (!boards || boards.length === 0)) {
    return (
      <div className="page">
        <div className="wbs-empty">
          <div className="wbs-empty__icon">📊</div>
          <p>{t("wbs.no_boards")}</p>
          <Link className="btn btn--accent" to="/kanban">{t("wbs.go_kanban")}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`wbs-page${selected_card ? " wbs-page--detail" : ""}`}>
      {/* ── 헤더 ── */}
      <div className="wbs-header">
        <select
          className="wbs-board-select"
          value={board_id}
          onChange={e => set_board(e.target.value)}
          aria-label={t("kanban.board_name")}
        >
          {(boards ?? []).map(b => (
            <option key={b.board_id} value={b.board_id}>{b.name}</option>
          ))}
        </select>
        <span className="wbs-header__title">{t("wbs.title")}</span>
        <div className="wbs-header__actions">
          <input
            className="wbs-search"
            type="search"
            placeholder={t("wbs.search_placeholder")}
            value={search}
            onChange={e => set_search(e.target.value)}
            aria-label={t("wbs.search_placeholder")}
          />
          <label className="wbs-toggle-label">
            <input
              type="checkbox"
              checked={show_done}
              onChange={e => set_show_done(e.target.checked)}
            />
            {t("wbs.show_done")}
          </label>
          <button className="btn btn--xs" onClick={refresh} aria-label={t("wbs.refresh")}>↺</button>
          <Link className="btn btn--xs" to={`/kanban?board=${board_id}`} title={t("wbs.switch_to_kanban")}>
            ▦
          </Link>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="wbs-body">
        <div className="wbs-table-wrap">
          {isPending ? (
            <div className="wbs-loading"><div className="skeleton skeleton-card" /></div>
          ) : flat.length === 0 ? (
            <div className="wbs-empty">
              <div className="wbs-empty__icon">📋</div>
              <p>{t("wbs.no_items")}</p>
            </div>
          ) : (
            <table className="wbs-table" aria-label={t("wbs.title")}>
              <thead>
                <tr>
                  <th className="wbs-th">{t("wbs.col_code")}</th>
                  <th className="wbs-th wbs-th--title">{t("wbs.col_title")}</th>
                  <th className="wbs-th">{t("wbs.col_status")}</th>
                  <th className="wbs-th">{t("wbs.col_priority")}</th>
                  <th className="wbs-th">{t("wbs.col_assignee")}</th>
                  <th className="wbs-th wbs-th--progress">{t("wbs.col_progress")}</th>
                  <th className="wbs-th">{t("wbs.col_updated")}</th>
                </tr>
              </thead>
              <tbody>
                {flat.map(node => (
                  <WbsRow
                    key={node.card.card_id}
                    node={node}
                    selected={selected_card === node.card.card_id}
                    on_select={id => set_selected_card(id === selected_card ? null : id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── 상세 패널 ── */}
        {selected_card && (() => {
          const card = all_cards.find(c => c.card_id === selected_card);
          return card ? (
            <WbsDetailPanel
              card={card}
              board_id={board_id}
              columns={columns}
              on_close={() => set_selected_card(null)}
              on_update={refresh}
            />
          ) : null;
        })()}
      </div>
    </div>
  );
}
