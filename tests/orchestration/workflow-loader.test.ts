import { describe, it, expect } from "vitest";
import {
  substitute_variables,
  slugify,
  normalize_workflow_definition,
  parse_workflow_yaml,
  serialize_to_yaml,
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

  it("trigger (cron) 파싱", () => {
    const raw = {
      title: "T",
      phases: [{ phase_id: "p", agents: [{ role: "a" }] }],
      trigger: { type: "cron", schedule: "0 9 * * *", timezone: "Asia/Seoul" },
    };
    const result = normalize_workflow_definition(raw);
    expect(result!.trigger).toEqual({
      type: "cron",
      schedule: "0 9 * * *",
      timezone: "Asia/Seoul",
    });
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
      nodes: [{ node_id: "n1", node_type: "llm" }],
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
