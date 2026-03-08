/**
 * KanbanTool — 미커버 분기 추가 보충.
 * board_metrics velocity, card_time_tracking current 표시,
 * list_activities detail JSON, handle_update_card 다양한 파라미터,
 * handle_board_summary 0% case, store throw → catch 경로,
 * update_board name/columns 업데이트, set_rule_executor.
 */
import { describe, it, expect, vi } from "vitest";
import { KanbanTool } from "@src/agent/tools/kanban.js";
import type { KanbanStoreLike } from "@src/services/kanban-store.js";

function make_store(overrides: Partial<KanbanStoreLike> = {}): KanbanStoreLike {
  return {
    create_board: vi.fn(),
    list_boards: vi.fn().mockResolvedValue([]),
    get_board: vi.fn().mockResolvedValue(null),
    board_summary: vi.fn().mockResolvedValue(null),
    create_card: vi.fn(),
    get_card: vi.fn().mockResolvedValue(null),
    update_card: vi.fn().mockResolvedValue(null),
    move_card: vi.fn().mockResolvedValue(null),
    delete_card: vi.fn().mockResolvedValue(false),
    list_cards: vi.fn().mockResolvedValue([]),
    add_comment: vi.fn().mockResolvedValue({}),
    list_comments: vi.fn().mockResolvedValue([]),
    add_relation: vi.fn(),
    remove_relation: vi.fn().mockResolvedValue(false),
    list_relations: vi.fn().mockResolvedValue([]),
    get_subtasks: vi.fn().mockResolvedValue([]),
    list_activities: vi.fn().mockResolvedValue([]),
    add_rule: vi.fn(),
    list_rules: vi.fn().mockResolvedValue([]),
    remove_rule: vi.fn().mockResolvedValue(false),
    update_rule: vi.fn().mockResolvedValue(null),
    create_template: vi.fn(),
    list_templates: vi.fn().mockResolvedValue([]),
    get_template: vi.fn().mockResolvedValue(null),
    delete_template: vi.fn().mockResolvedValue(false),
    get_board_metrics: vi.fn().mockResolvedValue(null),
    get_card_time_tracking: vi.fn().mockResolvedValue(null),
    search_cards: vi.fn().mockResolvedValue([]),
    save_filter: vi.fn(),
    list_filters: vi.fn().mockResolvedValue([]),
    delete_filter: vi.fn().mockResolvedValue(false),
    update_board: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as KanbanStoreLike;
}

// ══════════════════════════════════════════
// board_metrics — velocity 섹션
// ══════════════════════════════════════════

describe("KanbanTool — board_metrics: velocity 포함", () => {
  it("velocity 항목 있음 → 주간 velocity 출력됨", async () => {
    const store = make_store({
      get_board_metrics: vi.fn().mockResolvedValue({
        throughput: 5,
        avg_cycle_time_hours: 12,
        cards_by_column: { todo: 2, in_progress: 1, done: 5 },
        cards_by_priority: { high: 3, medium: 4, low: 1, none: 0 },
        velocity: [
          { week: "2026-W10", done: 3 },
          { week: "2026-W11", done: 2 },
        ],
      }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "board_metrics", board_id: "B1" });
    expect(r).toContain("velocity");
    expect(r).toContain("2026-W10");
    expect(r).toContain("done");
  });
});

// ══════════════════════════════════════════
// card_time_tracking — current (no exited_at) 표시
// ══════════════════════════════════════════

describe("KanbanTool — card_time_tracking: current 상태 표시", () => {
  it("exited_at 없음 → '← current' 표시됨", async () => {
    const store = make_store({
      get_card_time_tracking: vi.fn().mockResolvedValue({
        total_hours: 5.5,
        column_times: [
          { column_id: "todo", duration_hours: 1, exited_at: "2026-01-01" },
          { column_id: "in_progress", duration_hours: 4.5, exited_at: null }, // current
        ],
      }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "card_time_tracking", card_id: "ISS-1" });
    expect(r).toContain("current");
    expect(r).toContain("in_progress");
    expect(r).toContain("4.5h");
  });
});

// ══════════════════════════════════════════
// list_activities — detail JSON 출력
// ══════════════════════════════════════════

describe("KanbanTool — list_activities: detail JSON 포함", () => {
  it("detail 객체 있는 활동 → JSON 직렬화 출력", async () => {
    const store = make_store({
      list_activities: vi.fn().mockResolvedValue([
        {
          created_at: "2026-01-01T10:00Z",
          actor: "agent",
          action: "moved",
          card_id: "ISS-1",
          detail: { from: "todo", to: "in_progress" },
        },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_activities", card_id: "ISS-1" });
    expect(r).toContain("from");
    expect(r).toContain("to");
  });

  it("detail 없는 활동 → JSON 없이 출력", async () => {
    const store = make_store({
      list_activities: vi.fn().mockResolvedValue([
        {
          created_at: "2026-01-01T10:00Z",
          actor: "agent",
          action: "created",
          card_id: "ISS-1",
          detail: {}, // 빈 객체
        },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_activities", board_id: "B1" });
    expect(r).toContain("created");
    expect(r).not.toContain("{}");
  });
});

// ══════════════════════════════════════════
// handle_update_card — 다양한 파라미터
// ══════════════════════════════════════════

describe("KanbanTool — update_card: assignee/due_date null 클리어", () => {
  it("assignee=null로 클리어", async () => {
    const store = make_store({
      update_card: vi.fn().mockResolvedValue({ card_id: "ISS-1" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "update_card", card_id: "ISS-1", assignee: null });
    expect(r).toContain("ISS-1 updated");
    // assignee: null → null 전달됨
    const call_arg = (store.update_card as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call_arg.assignee).toBeNull();
  });

  it("due_date=null로 클리어", async () => {
    const store = make_store({
      update_card: vi.fn().mockResolvedValue({ card_id: "ISS-2" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "update_card", card_id: "ISS-2", due_date: null });
    expect(r).toContain("ISS-2 updated");
    const call_arg = (store.update_card as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call_arg.due_date).toBeNull();
  });
});

// ══════════════════════════════════════════
// board_summary — total=0 (0% 퍼센트)
// ══════════════════════════════════════════

describe("KanbanTool — board_summary: total=0 경우", () => {
  it("카드 0개인 보드 → 0% 진행률", async () => {
    const store = make_store({
      board_summary: vi.fn().mockResolvedValue({
        name: "빈 보드",
        total: 0,
        done: 0,
        columns: [{ name: "todo", count: 0 }],
        blockers: [],
      }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "board_summary", board_id: "B1" });
    expect(r).toContain("0/0 done (0%)");
  });
});

// ══════════════════════════════════════════
// store throw → catch 경로
// ══════════════════════════════════════════

describe("KanbanTool — store throw → catch", () => {
  it("store 메서드 throw → Error: 메시지 반환", async () => {
    const store = make_store({
      create_board: vi.fn().mockRejectedValue(new Error("DB 연결 실패")),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "create_board", name: "테스트", scope_type: "channel", scope_id: "ch1" });
    expect(r).toContain("Error: DB 연결 실패");
  });
});

// ══════════════════════════════════════════
// update_board — name/columns 업데이트
// ══════════════════════════════════════════

describe("KanbanTool — update_board: 업데이트 성공", () => {
  it("보드 이름 변경 성공", async () => {
    const store = make_store({
      update_board: vi.fn().mockResolvedValue({ board_id: "B1", name: "새 이름" }),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "update_board", board_id: "B1", name: "새 이름" });
    expect(r).toContain("B1");
    expect(r).toContain("새 이름");
  });

  it("board_id 없음 → Error", async () => {
    const store = make_store();
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "update_board", board_id: "" });
    expect(r).toContain("board_id is required");
  });
});

// ══════════════════════════════════════════
// set_rule_executor — 주입
// ══════════════════════════════════════════

describe("KanbanTool — set_rule_executor 주입", () => {
  it("set_rule_executor 후 rule 생성 시 watch 호출됨", async () => {
    const watch = vi.fn();
    const store = make_store({
      add_rule: vi.fn().mockResolvedValue({
        rule_id: "R1",
        board_id: "B1",
        trigger: "card_moved",
        action_type: "comment",
        condition: {},
        action_params: {},
        enabled: true,
      }),
    });
    const tool = new KanbanTool(store);
    tool.set_rule_executor({ watch } as any);
    await tool.execute({ action: "add_rule", board_id: "B1", trigger: "card_moved", action_type: "comment" });
    expect(watch).toHaveBeenCalledWith("B1");
  });
});

// ══════════════════════════════════════════
// archive_card — 성공/실패 경로
// ══════════════════════════════════════════

describe("KanbanTool — archive_card", () => {
  it("카드 삭제 성공", async () => {
    const store = make_store({ delete_card: vi.fn().mockResolvedValue(true) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "archive_card", card_id: "ISS-1" });
    expect(r).toContain("ISS-1 archived");
  });

  it("카드 없음 → Error", async () => {
    const store = make_store({ delete_card: vi.fn().mockResolvedValue(false) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "archive_card", card_id: "ISS-999" });
    expect(r).toContain("Error: card not found");
  });
});

// ══════════════════════════════════════════
// list_boards — 빈 목록 / 목록 있음
// ══════════════════════════════════════════

describe("KanbanTool — list_boards", () => {
  it("보드 없음 → '보드 없음'", async () => {
    const store = make_store({ list_boards: vi.fn().mockResolvedValue([]) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_boards" });
    expect(r).toContain("보드 없음");
  });

  it("보드 있음 → 목록 출력", async () => {
    const store = make_store({
      list_boards: vi.fn().mockResolvedValue([
        { board_id: "B1", name: "내 보드", scope_type: "channel", scope_id: "ch1", prefix: "MB" },
      ]),
    });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "list_boards" });
    expect(r).toContain("B1");
    expect(r).toContain("내 보드");
  });
});

// ══════════════════════════════════════════
// remove_relation — relation_id 없음
// ══════════════════════════════════════════

describe("KanbanTool — remove_relation", () => {
  it("relation_id 없음 → Error", async () => {
    const store = make_store();
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "remove_relation", relation_id: "" });
    expect(r).toContain("relation_id is required");
  });

  it("없는 relation → Error: relation not found", async () => {
    const store = make_store({ remove_relation: vi.fn().mockResolvedValue(false) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "remove_relation", relation_id: "R999" });
    expect(r).toContain("relation not found");
  });

  it("관계 삭제 성공", async () => {
    const store = make_store({ remove_relation: vi.fn().mockResolvedValue(true) });
    const tool = new KanbanTool(store);
    const r = await tool.execute({ action: "remove_relation", relation_id: "R1" });
    expect(r).toContain("relation removed");
  });
});
