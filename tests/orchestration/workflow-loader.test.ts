import { describe, it, expect } from "vitest";
import {
  substitute_variables,
  slugify,
  normalize_workflow_definition,
  parse_workflow_yaml,
  serialize_to_yaml,
  workflow_to_flowchart,
  workflow_to_sequence,
} from "@src/orchestration/workflow-loader.js";
import type { WorkflowDefinition } from "@src/agent/phase-loop.types.js";

describe("slugify", () => {
  it("소문자 변환", () => {
    expect(slugify("HelloWorld")).toBe("helloworld");
  });

  it("특수문자 → 하이픈 (앞뒤 제거)", () => {
    expect(slugify("my workflow!")).toBe("my-workflow");
  });

  it("연속 하이픈 병합", () => {
    expect(slugify("a---b")).toBe("a-b");
  });

  it("앞뒤 하이픈 제거", () => {
    expect(slugify("-hello-")).toBe("hello");
  });

  it("한글 보존", () => {
    expect(slugify("뉴스 요약")).toBe("뉴스-요약");
  });

  it("빈 문자열 → untitled", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("숫자와 언더스코어 보존", () => {
    expect(slugify("task_v2")).toBe("task_v2");
  });
});

describe("substitute_variables", () => {
  const base_def: WorkflowDefinition = {
    title: "Test: {{name}}",
    objective: "Process {{target}}",
    phases: [],
  };

  it("변수 치환", () => {
    const result = substitute_variables(base_def, { name: "Bot", target: "data" });
    expect(result.title).toBe("Test: Bot");
    expect(result.objective).toBe("Process data");
  });

  it("미정의 변수는 그대로 유지", () => {
    const result = substitute_variables(base_def, { name: "Bot" });
    expect(result.objective).toBe("Process {{target}}");
  });

  it("빈 vars 객체 → 원본 유지", () => {
    const result = substitute_variables(base_def, {});
    expect(result.title).toBe("Test: {{name}}");
  });

  it("큰따옴표 이스케이프", () => {
    const result = substitute_variables(base_def, { name: 'He said "hi"' });
    expect(result.title).toBe('Test: He said "hi"');
  });

  it("제어문자 이스케이프 (개행/탭)", () => {
    const result = substitute_variables(base_def, { name: "line1\nline2\ttab" });
    expect(result.title).toBe("Test: line1\nline2\ttab");
  });

  it("백슬래시 이스케이프", () => {
    const result = substitute_variables(base_def, { name: "C:\\Users\\test" });
    expect(result.title).toBe("Test: C:\\Users\\test");
  });

  it("중첩 구조의 변수도 치환", () => {
    const def: WorkflowDefinition = {
      title: "WF",
      objective: "",
      phases: [{
        phase_id: "p1",
        title: "Phase {{num}}",
        agents: [{ agent_id: "a1", role: "{{role}}", label: "", system_prompt: "" }],
      }],
    };
    const result = substitute_variables(def, { num: "1", role: "reviewer" });
    expect(result.phases[0].title).toBe("Phase 1");
    expect(result.phases[0].agents[0].role).toBe("reviewer");
  });
});

describe("normalize_workflow_definition", () => {
  it("title 없으면 null", () => {
    expect(normalize_workflow_definition({ phases: [] })).toBeNull();
  });

  it("phases도 nodes도 없으면 null", () => {
    expect(normalize_workflow_definition({ title: "T" })).toBeNull();
  });

  it("빈 phases 배열 + nodes 없음 → null", () => {
    expect(normalize_workflow_definition({ title: "T", phases: [] })).toBeNull();
  });

  it("유효한 phases 파싱", () => {
    const raw = {
      title: "Test WF",
      objective: "Do things",
      phases: [{
        phase_id: "p1",
        title: "Phase 1",
        agents: [{ role: "coder", system_prompt: "code it" }],
      }],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test WF");
    expect(result!.phases).toHaveLength(1);
    expect(result!.phases[0].phase_id).toBe("p1");
    expect(result!.phases[0].agents[0].role).toBe("coder");
  });

  it("agents 없는 phase → skip", () => {
    const raw = {
      title: "T",
      phases: [
        { phase_id: "p1" }, // agents 없음 → 스킵
        { phase_id: "p2", agents: [{ role: "a" }] },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.phases).toHaveLength(1);
    expect(result!.phases[0].phase_id).toBe("p2");
  });

  it("nodes 배열 파싱", () => {
    const raw = {
      title: "DAG WF",
      nodes: [
        { node_id: "n1", node_type: "llm", title: "LLM Call" },
        { node_id: "n2", node_type: "http", depends_on: ["n1"] },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(2);
    expect(result!.nodes![1].depends_on).toEqual(["n1"]);
  });

  it("node_id 또는 node_type 없는 노드 필터링", () => {
    const raw = {
      title: "T",
      nodes: [
        { node_id: "n1", node_type: "llm" },
        { node_id: "n2" }, // node_type 없음
        { node_type: "http" }, // node_id 없음
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.nodes).toHaveLength(1);
  });

  it("variables 파싱", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      variables: { key: "value", num: 42 },
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.variables).toEqual({ key: "value", num: "42" });
  });

  it("trigger (cron) 파싱 → trigger_nodes 변환 + timezone 보존", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      trigger: { type: "cron", schedule: "0 9 * * *", timezone: "Asia/Seoul" },
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.trigger_nodes).toHaveLength(1);
    const tn = result!.trigger_nodes![0];
    expect(tn.trigger_type).toBe("cron");
    expect(tn.schedule).toBe("0 9 * * *");
    expect(tn.timezone).toBe("Asia/Seoul");
  });

  it("trigger → trigger_nodes 자동 변환", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      trigger: { type: "cron", schedule: "0 9 * * *" },
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.trigger_nodes).toHaveLength(1);
    expect(result!.trigger_nodes![0].id).toBe("__cron__");
    expect(result!.trigger_nodes![0].trigger_type).toBe("cron");
  });

  it("tool_nodes 파싱", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      tool_nodes: [{ id: "t1", tool_id: "web_search", attach_to: ["p"] }],
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.tool_nodes).toHaveLength(1);
    expect(result!.tool_nodes![0].tool_id).toBe("web_search");
  });

  it("hitl_channel 파싱", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      hitl_channel: { channel_type: "telegram", chat_id: "123" },
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.hitl_channel).toEqual({ channel_type: "telegram", chat_id: "123" });
  });

  it("field_mappings 파싱", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "n1", agents: [{ role: "a" }] }, { phase_id: "n2", agents: [{ role: "b" }] }],
      field_mappings: [
        { from_node: "n1", from_field: "output", to_node: "n2", to_field: "input" },
        { from_node: "n1" }, // from_field 없음 → 필터링
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.field_mappings).toHaveLength(1);
    expect(result!.field_mappings![0].from_field).toBe("output");
  });

  it("critic 파싱", () => {
    const raw = {
      title: "T",
      phases: [{
        phase_id: "p",
        agents: [{ role: "a" }],
        critic: {
          backend: "claude_sdk",
          system_prompt: "review",
          gate: true,
          max_retries: 3,
        },
      }],
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.phases[0].critic).toBeDefined();
    expect(result!.phases[0].critic!.backend).toBe("claude_sdk");
    expect(result!.phases[0].critic!.max_retries).toBe(3);
  });
});

describe("parse_workflow_yaml / serialize_to_yaml", () => {
  it("JSON 직렬화 → 파싱 왕복", () => {
    const def: WorkflowDefinition = {
      title: "Round Trip",
      objective: "test",
      phases: [{ phase_id: "p1", title: "P1", agents: [{ agent_id: "a1", role: "dev", label: "Dev", system_prompt: "code" }] }],
    };
    const serialized = serialize_to_yaml(def);
    const parsed = parse_workflow_yaml(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Round Trip");
    expect(parsed!.phases[0].agents[0].role).toBe("dev");
  });

  it("잘못된 YAML → null", () => {
    expect(parse_workflow_yaml("{}")).toBeNull(); // title 없음
  });
});

// ══════════════════════════════════════════
// skill_nodes 파싱 (L233-240) — from cov2
// ══════════════════════════════════════════

const base_phases = [{ phase_id: "p1", agents: [{ role: "a" }] }];

describe("normalize_workflow_definition — skill_nodes (L233-240)", () => {
  it("skill_nodes 배열 파싱", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      skill_nodes: [
        { id: "s1", skill_name: "web_search", description: "검색 스킬", attach_to: ["p1"] },
        { id: "s2", skill_name: "summarize" },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.skill_nodes).toHaveLength(2);
    expect(result!.skill_nodes![0].skill_name).toBe("web_search");
    expect(result!.skill_nodes![0].attach_to).toEqual(["p1"]);
    expect(result!.skill_nodes![1].description).toBe("summarize");
  });
});

// ══════════════════════════════════════════
// orche_nodes 파싱 (L260-270) — from cov2
// ══════════════════════════════════════════

describe("normalize_workflow_definition — orche_nodes (L260-270)", () => {
  it("orche_nodes 배열 파싱 — node_id/node_type 없는 것 필터", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      orche_nodes: [
        { node_id: "o1", node_type: "http", title: "HTTP Call", depends_on: ["p1"] },
        { node_id: "o2", node_type: "if" },
        { node_type: "set" },
        { node_id: "o3" },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result).not.toBeNull();
    expect(result!.orche_nodes).toHaveLength(2);
    expect(result!.orche_nodes![0].node_id).toBe("o1");
    expect(result!.orche_nodes![0].depends_on).toEqual(["p1"]);
    expect(result!.orche_nodes![1].title).toBe("o2");
  });
});

// ══════════════════════════════════════════
// trigger_nodes 배열 직접 파싱 (L273-288) — from cov2
// ══════════════════════════════════════════

describe("normalize_workflow_definition — trigger_nodes (L273-288)", () => {
  it("trigger_nodes 배열 직접 파싱 — cron + webhook", () => {
    const raw = {
      title: "T",
      phases: base_phases,
      trigger_nodes: [
        { id: "tn1", trigger_type: "cron", schedule: "0 9 * * *", timezone: "Asia/Seoul" },
        { id: "tn2", trigger_type: "webhook", webhook_path: "/hooks/test" },
        { trigger_type: "cron", schedule: "* * * * *" },
        { id: "tn4" },
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
        { id: "tn1", trigger_type: "channel_message", channel_type: "slack", chat_id: "C123" },
        { id: "tn2", trigger_type: "kanban_event", kanban_board_id: "board1", kanban_actions: ["card_moved", "card_created"], kanban_column_id: "col1" },
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
    const raw = {
      title: "T",
      phases: base_phases,
      trigger: { type: "cron", schedule: "0 0 * * *" },
      trigger_nodes: [
        { id: "manual_tn", trigger_type: "cron", schedule: "0 9 * * *" },
      ],
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.trigger_nodes).toHaveLength(1);
    expect(result!.trigger_nodes![0].id).toBe("manual_tn");
  });
});

// ══════════════════════════════════════════════════════════
// substitute_variables — 특수문자 이스케이프 (L102-107) — from cov3
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
// workflow_to_flowchart (L182-234) — from cov3
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
    const def = { ...base, end_nodes: [{ node_id: "end1", output_targets: ["slack"], depends_on: ["http1"] }] };

    const result = workflow_to_flowchart(def);

    expect(result).toContain("```mermaid");
    expect(result).toContain("flowchart LR");
    expect(result).toContain("⏰");
    expect(result).toContain("phase-a");
    expect(result).toContain("phase-b");
    expect(result).toContain("{{");
    expect(result).toContain("http1");
    expect(result).toContain("⏹");
    expect(result).toContain("slack");
    expect(result).toContain("__cron__ --> phase-a");
    expect(result).toContain("phase-a --> phase-b");
    expect(result).toContain("-.->|FAIL|");
    expect(result).toContain("phase-b --> if1");
    expect(result).toContain("http1 --> end1");
  });

  it("trigger_nodes + phases — webhook 트리거 아이콘", () => {
    const def = normalize_workflow_definition({
      title: "Webhook Flow",
      trigger_nodes: [{ id: "wh1", trigger_type: "webhook", webhook_path: "/hook" }],
      phases: [{ phase_id: "ph1", agents: [{ role: "a" }], depends_on: ["wh1"] }],
    } as any)!;

    const result = workflow_to_flowchart(def);
    expect(result).toContain("↗");
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
    expect(result).toContain("🔁");
    expect(result).toContain("🔄");
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
// workflow_to_sequence (L238-291) — from cov3
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
    expect(result).toContain("💬");
    expect(result).toContain("tr1->>+ph1: trigger");
    expect(result).toContain("Analyst");
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

    expect(result).toContain("ph1_critic");
    expect(result).toContain("⚖ Critic");
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
// field_mappings 중복 제거 (L437-440) — from cov3
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
        { from_node: "src", from_field: "output", to_node: "dst", to_field: "input" },
        { from_node: "src", from_field: "result", to_node: "dst", to_field: "data" },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.field_mappings).toHaveLength(2);
  });

  it("존재하지 않는 노드 참조 → 필터링", () => {
    const result = normalize_workflow_definition({
      title: "FM Invalid",
      phases: [{ phase_id: "real", agents: [{ role: "a" }] }],
      field_mappings: [
        { from_node: "real", from_field: "out", to_node: "ghost", to_field: "in" },
        { from_node: "ghost", from_field: "out", to_node: "real", to_field: "in" },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.field_mappings?.length ?? 0).toBe(0);
  });
});
