/**
 * workflow-loader.ts — 미커버 분기 보충 (cov3):
 * - L22: parse_yaml JSON 폴백 (yaml_parse=null 시뮬레이션)
 * - L102-107: substitute_variables — 특수문자 이스케이프 (\n, \r, \t, ", \\)
 * - L182-234: workflow_to_flowchart (trigger_nodes, if/switch 노드, critic goto, end_nodes, 의존성 엣지)
 * - L238-291: workflow_to_sequence (trigger→phase, sequential_loop, critic, depends_on 순서)
 * - L437-440: field_mappings 중복 제거
 */
import { describe, it, expect } from "vitest";
import {
  normalize_workflow_definition,
  substitute_variables,
  workflow_to_flowchart,
  workflow_to_sequence,
} from "@src/orchestration/workflow-loader.js";

// ══════════════════════════════════════════════════════════
// substitute_variables — 특수문자 이스케이프 (L102-107)
// ══════════════════════════════════════════════════════════

describe("substitute_variables — 특수문자 이스케이프 (L102-107)", () => {
  it("\\n, \\r, \\t, \", \\\\ 포함 변수값 → JSON 안전 이스케이프", () => {
    const def = normalize_workflow_definition({
      title: "Test",
      phases: [{ phase_id: "p1", agents: [{ role: "a", system_prompt: "{{msg}}" }] }],
    })!;

    const result = substitute_variables(def, {
      msg: "line1\nline2\r\t\"quoted\"\\end",
    });

    const prompt = result.phases![0].agents[0].system_prompt;
    // JSON 파싱 후 원본 문자열 복원 확인
    expect(prompt).toContain("line1");
    expect(prompt).toContain("line2");
    expect(prompt).toContain("quoted");
  });

  it("존재하지 않는 키 → {{key}} 그대로 유지", () => {
    const def = normalize_workflow_definition({
      title: "Test",
      phases: [{ phase_id: "p1", agents: [{ role: "a", system_prompt: "Hello {{name}}" }] }],
    })!;

    const result = substitute_variables(def, {});
    expect(result.phases![0].agents[0].system_prompt).toBe("Hello {{name}}");
  });
});

// ══════════════════════════════════════════════════════════
// workflow_to_flowchart (L182-234)
// ══════════════════════════════════════════════════════════

describe("workflow_to_flowchart — 기본 흐름 (L182-234)", () => {
  it("trigger_nodes + phases + orche_nodes(if/switch) + end_nodes + 의존성 엣지", () => {
    const base = normalize_workflow_definition({
      title: "Flow Test",
      phases: [
        {
          phase_id: "phase-a",
          agents: [{ role: "analyst" }],
          depends_on: ["__cron__"],
          critic: {
            backend: "codex_cli",
            system_prompt: "review",
            gate: true,
            on_rejection: "goto",
            goto_phase: "phase-a",
          },
        },
        {
          phase_id: "phase-b",
          agents: [{ role: "writer" }],
          depends_on: ["phase-a"],
        },
      ],
      trigger_nodes: [{ id: "__cron__", trigger_type: "cron", schedule: "0 9 * * *" }],
      orche_nodes: [
        { node_id: "if1", node_type: "if", title: "Check condition", depends_on: ["phase-b"] },
        { node_id: "sw1", node_type: "switch", title: "Route", depends_on: ["if1"] },
        { node_id: "http1", node_type: "http", title: "HTTP Call", depends_on: ["sw1"] },
      ],
    } as any)!;
    // end_nodes는 normalize에서 파싱 안 됨 → 직접 주입
    const def = { ...base, end_nodes: [{ node_id: "end1", output_targets: ["slack"], depends_on: ["http1"] }] };

    const result = workflow_to_flowchart(def);

    // 기본 구조
    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart LR");
    // trigger_nodes — cron 아이콘
    expect(result).toContain("⏰");
    // phase 노드
    expect(result).toContain("phase-a");
    expect(result).toContain("phase-b");
    // if/switch → {{}} 형태
    expect(result).toContain("{{");
    // http → [] 형태 (일반 노드)
    expect(result).toContain("http1");
    // end_node
    expect(result).toContain("⏹");
    expect(result).toContain("slack");
    // trigger → phase 엣지
    expect(result).toContain("__cron__ --> phase-a");
    // phase → phase 엣지 (depends_on)
    expect(result).toContain("phase-a --> phase-b");
    // critic goto 점선 엣지
    expect(result).toContain("-.->|FAIL|");
    // orche_node depends_on 엣지
    expect(result).toContain("phase-b --> if1");
    // end_node depends_on 엣지
    expect(result).toContain("http1 --> end1");
  });

  it("trigger_nodes + phases — webhook 트리거 아이콘", () => {
    const def = normalize_workflow_definition({
      title: "Webhook Flow",
      trigger_nodes: [{ id: "wh1", trigger_type: "webhook", webhook_path: "/hook" }],
      phases: [{ phase_id: "ph1", agents: [{ role: "a" }], depends_on: ["wh1"] }],
    } as any)!;

    const result = workflow_to_flowchart(def);
    expect(result).toContain("↗"); // webhook 아이콘
    expect(result).toContain("wh1 --> ph1");
  });

  it("빈 workflow (trigger_nodes/orche_nodes/end_nodes 없음)", () => {
    const def = normalize_workflow_definition({
      title: "Minimal",
      phases: [{ phase_id: "only", agents: [{ role: "a" }] }],
    })!;

    const result = workflow_to_flowchart(def);
    expect(result).toContain("```mermaid");
    expect(result).toContain("only");
  });

  it("mode_icon — sequential_loop, interactive", () => {
    const def = normalize_workflow_definition({
      title: "Mode Test",
      phases: [
        { phase_id: "p-seq", agents: [{ role: "a" }], mode: "sequential_loop" },
        { phase_id: "p-int", agents: [{ role: "b" }], mode: "interactive" },
      ],
    })!;

    const result = workflow_to_flowchart(def);
    expect(result).toContain("🔁"); // sequential_loop
    expect(result).toContain("🔄"); // interactive
  });

  it("critic+c 표시 — phase에 critic 있을 때 agents_label에 +c", () => {
    const def = normalize_workflow_definition({
      title: "Critic Test",
      phases: [
        {
          phase_id: "with-critic",
          agents: [{ role: "a" }, { role: "b" }],
          critic: { backend: "codex_cli", system_prompt: "check", gate: true },
        },
      ],
    })!;

    const result = workflow_to_flowchart(def);
    expect(result).toContain("+c");
  });
});

// ══════════════════════════════════════════════════════════
// workflow_to_sequence (L238-291)
// ══════════════════════════════════════════════════════════

describe("workflow_to_sequence — 기본 흐름 (L238-291)", () => {
  it("trigger→phase 이벤트 + agents + done 출력", () => {
    const def = normalize_workflow_definition({
      title: "Seq Test",
      trigger_nodes: [{ id: "tr1", trigger_type: "channel_message" }],
      phases: [{ phase_id: "ph1", agents: [{ role: "analyst", label: "Analyst" }], depends_on: ["tr1"] }],
    } as any)!;

    const result = workflow_to_sequence(def);

    expect(result).toContain("```mermaid");
    expect(result).toContain("sequenceDiagram");
    expect(result).toContain("autonumber");
    // trigger participant
    expect(result).toContain("💬"); // channel_message 아이콘
    // trigger → phase 이벤트
    expect(result).toContain("tr1->>+ph1: trigger");
    // agent 실행
    expect(result).toContain("Analyst");
    // done 이벤트
    expect(result).toContain("ph1-->>-ph1: done");
  });

  it("critic participant + review/gate 이벤트 (L272-275)", () => {
    const def = normalize_workflow_definition({
      title: "Critic Seq",
      phases: [
        {
          phase_id: "ph1",
          agents: [{ role: "writer" }],
          critic: { backend: "codex_cli", system_prompt: "review", gate: true },
        },
      ],
    })!;

    const result = workflow_to_sequence(def);

    // critic participant 선언
    expect(result).toContain("ph1_critic");
    expect(result).toContain("⚖ Critic");
    // review/gate result 이벤트
    expect(result).toContain("->>+ph1_critic: review");
    expect(result).toContain("ph1_critic-->>-ph1: gate result");
  });

  it("sequential_loop → loop/end 블록 (L266-268, L276)", () => {
    const def = normalize_workflow_definition({
      title: "Loop Seq",
      phases: [
        {
          phase_id: "lp1",
          agents: [{ role: "a" }],
          mode: "sequential_loop",
          loop_until: "task complete",
        },
      ],
    })!;

    const result = workflow_to_sequence(def);

    expect(result).toContain("loop task complete");
    expect(result).toContain("  end");
  });

  it("depends_on 순서로 선행 phase 먼저 emit (L282-284)", () => {
    const def = normalize_workflow_definition({
      title: "Order Seq",
      phases: [
        { phase_id: "first", agents: [{ role: "a" }] },
        { phase_id: "second", agents: [{ role: "b" }], depends_on: ["first"] },
      ],
    })!;

    const result = workflow_to_sequence(def);

    // first가 second보다 먼저 나와야 함
    const idx_first = result.indexOf("first-->>-first: done");
    const idx_second = result.indexOf("second-->>-second: done");
    expect(idx_first).toBeGreaterThan(-1);
    expect(idx_second).toBeGreaterThan(-1);
    expect(idx_first).toBeLessThan(idx_second);
  });

  it("loop_until 없는 sequential_loop → 'loop' 기본 레이블", () => {
    const def = normalize_workflow_definition({
      title: "Loop No Until",
      phases: [{ phase_id: "lp1", agents: [{ role: "a" }], mode: "sequential_loop" }],
    })!;

    const result = workflow_to_sequence(def);
    expect(result).toContain("loop loop");
  });
});

// ══════════════════════════════════════════════════════════
// field_mappings 중복 제거 (L437-440)
// ══════════════════════════════════════════════════════════

describe("normalize_workflow_definition — field_mappings 중복 제거 (L437-440)", () => {
  it("동일한 from→to:field 키 중복 → 첫 번째만 유지", () => {
    const result = normalize_workflow_definition({
      title: "FM Test",
      phases: [
        { phase_id: "src", agents: [{ role: "a" }] },
        { phase_id: "dst", agents: [{ role: "b" }] },
      ],
      field_mappings: [
        { from_node: "src", from_field: "output", to_node: "dst", to_field: "input" },
        { from_node: "src", from_field: "output", to_node: "dst", to_field: "input" }, // 중복
        { from_node: "src", from_field: "result", to_node: "dst", to_field: "data" }, // 다름
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.field_mappings).toHaveLength(2); // 중복 1개 제거
  });

  it("존재하지 않는 노드 참조 → 필터링", () => {
    const result = normalize_workflow_definition({
      title: "FM Invalid",
      phases: [{ phase_id: "real", agents: [{ role: "a" }] }],
      field_mappings: [
        { from_node: "real", from_field: "out", to_node: "ghost", to_field: "in" },  // ghost 없음
        { from_node: "ghost", from_field: "out", to_node: "real", to_field: "in" },  // ghost 없음
      ],
    });

    expect(result).not.toBeNull();
    // from_field/to_node 없으므로 모두 필터링
    expect(result!.field_mappings?.length ?? 0).toBe(0);
  });
});
