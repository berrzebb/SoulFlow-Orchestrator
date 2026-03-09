/**
 * workflow-loader.ts — 미커버 분기 보충 (cov2).
 * - skill_nodes 파싱 (L233-240)
 * - orche_nodes 파싱 (L260-270)
 * - trigger_nodes 배열 직접 파싱 (L273-288)
 */
import { describe, it, expect } from "vitest";
import { normalize_workflow_definition } from "@src/orchestration/workflow-loader.js";

const base_phases = [{ phase_id: "p1", agents: [{ role: "a" }] }];

// ══════════════════════════════════════════
// skill_nodes 파싱 (L233-240)
// ══════════════════════════════════════════

describe("normalize_workflow_definition — skill_nodes (L233-240)", () => {
  it("skill_nodes 배열 파싱", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      skill_nodes: [
        { id: "s1", skill_name: "web_search", description: "검색 스킬", attach_to: ["p1"] },
        { id: "s2", skill_name: "summarize" }, // description/attach_to 없음
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.skill_nodes).toHaveLength(2);
    expect(result!.skill_nodes![0].skill_name).toBe("web_search");
    expect(result!.skill_nodes![0].attach_to).toEqual(["p1"]);
    // description 없을 때 skill_name으로 대체
    expect(result!.skill_nodes![1].description).toBe("summarize");
  });
});

// ══════════════════════════════════════════
// orche_nodes 파싱 (L260-270)
// ══════════════════════════════════════════

describe("normalize_workflow_definition — orche_nodes (L260-270)", () => {
  it("orche_nodes 배열 파싱 — node_id/node_type 없는 것 필터", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      orche_nodes: [
        { node_id: "o1", node_type: "http", title: "HTTP Call", depends_on: ["p1"] },
        { node_id: "o2", node_type: "if" }, // title/depends_on 없음
        { node_type: "set" }, // node_id 없음 → 필터링
        { node_id: "o3" }, // node_type 없음 → 필터링
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.orche_nodes).toHaveLength(2);
    expect(result!.orche_nodes![0].node_id).toBe("o1");
    expect(result!.orche_nodes![0].depends_on).toEqual(["p1"]);
    // title 없을 때 node_id로 대체
    expect(result!.orche_nodes![1].title).toBe("o2");
  });
});

// ══════════════════════════════════════════
// trigger_nodes 배열 직접 파싱 (L273-288)
// ══════════════════════════════════════════

describe("normalize_workflow_definition — trigger_nodes (L273-288)", () => {
  it("trigger_nodes 배열 직접 파싱 — cron + webhook", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      trigger_nodes: [
        {
          id: "tn1",
          trigger_type: "cron",
          schedule: "0 9 * * *",
          timezone: "Asia/Seoul",
        },
        {
          id: "tn2",
          trigger_type: "webhook",
          webhook_path: "/hooks/test",
        },
        {
          // id 없음 → 필터링
          trigger_type: "cron",
          schedule: "* * * * *",
        },
        {
          id: "tn4",
          // trigger_type 없음 → 필터링
        },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.trigger_nodes).toHaveLength(2);
    expect(result!.trigger_nodes![0].id).toBe("tn1");
    expect(result!.trigger_nodes![0].trigger_type).toBe("cron");
    expect(result!.trigger_nodes![0].timezone).toBe("Asia/Seoul");
    expect(result!.trigger_nodes![1].webhook_path).toBe("/hooks/test");
  });

  it("trigger_nodes — channel/kanban 필드 파싱 (L280-287)", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      trigger_nodes: [
        {
          id: "tn1",
          trigger_type: "channel_message",
          channel_type: "slack",
          chat_id: "C123",
        },
        {
          id: "tn2",
          trigger_type: "kanban_event",
          kanban_board_id: "board1",
          kanban_actions: ["card_moved", "card_created"],
          kanban_column_id: "col1",
        },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.trigger_nodes).toHaveLength(2);
    expect(result!.trigger_nodes![0].channel_type).toBe("slack");
    expect(result!.trigger_nodes![0].chat_id).toBe("C123");
    expect(result!.trigger_nodes![1].kanban_board_id).toBe("board1");
    expect(result!.trigger_nodes![1].kanban_actions).toEqual(["card_moved", "card_created"]);
    expect(result!.trigger_nodes![1].kanban_column_id).toBe("col1");
  });

  it("trigger_nodes 있을 때 legacy trigger가 있어도 trigger_nodes 우선 (L290)", () => {
    // trigger_nodes가 있으면 legacy trigger → trigger_nodes 변환을 하지 않음
    const raw = {
      title: "T",
      phases: base_phases,
      trigger: { type: "cron", schedule: "0 0 * * *" },
      trigger_nodes: [
        { id: "manual_tn", trigger_type: "cron", schedule: "0 9 * * *" },
      ],
    };
    const result = normalize_workflow_definition(raw);
    // trigger_nodes가 있으므로 legacy 변환 없이 그대로 사용
    expect(result!.trigger_nodes).toHaveLength(1);
    expect(result!.trigger_nodes![0].id).toBe("manual_tn");
  });
});
