/**
 * StateMachineTool 커버리지 — define/transition/validate/visualize/reachable/history.
 */
import { describe, it, expect } from "vitest";
import { StateMachineTool } from "@src/agent/tools/state-machine.js";

const tool = new StateMachineTool();

const SIMPLE_MACHINE = JSON.stringify({
  initial: "idle",
  states: [
    { name: "idle", on: { START: "running" } },
    { name: "running", on: { STOP: "idle", PAUSE: "paused" } },
    { name: "paused", on: { RESUME: "running" } },
  ],
});

async function run(action: string, extra?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await tool.execute({ action, machine: SIMPLE_MACHINE, ...extra });
  return JSON.parse(result);
}

describe("StateMachineTool — 메타데이터", () => {
  it("name = state_machine", () => expect(tool.name).toBe("state_machine"));
  it("category = data", () => expect(tool.category).toBe("data"));
  it("to_schema: function 형식", () => {
    expect(tool.to_schema().type).toBe("function");
  });
});

describe("StateMachineTool — define", () => {
  it("define: 머신 정보 반환", async () => {
    const r = await run("define");
    expect(r.initial).toBe("idle");
    expect(r.state_count).toBe(3);
    expect(Array.isArray(r.states)).toBe(true);
    expect((r.states as string[]).sort()).toEqual(["idle", "paused", "running"]);
  });

  it("define: 이벤트 목록 포함", async () => {
    const r = await run("define");
    const events = r.events as string[];
    expect(events).toContain("START");
    expect(events).toContain("STOP");
  });

  it("define: transition_count 정확", async () => {
    const r = await run("define");
    expect(r.transition_count).toBe(4); // START, STOP, PAUSE, RESUME
  });

  it("define: 잘못된 machine JSON → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "define", machine: "invalid" }));
    expect(r.error).toBeDefined();
  });
});

describe("StateMachineTool — transition", () => {
  it("유효한 전이: idle + START → running", async () => {
    const r = await run("transition", { current: "idle", event: "START" });
    expect(r.from).toBe("idle");
    expect(r.to).toBe("running");
    expect(r.event).toBe("START");
  });

  it("유효한 전이: running + PAUSE → paused", async () => {
    const r = await run("transition", { current: "running", event: "PAUSE" });
    expect(r.to).toBe("paused");
  });

  it("없는 이벤트 → error", async () => {
    const r = await run("transition", { current: "idle", event: "INVALID" });
    expect(r.error).toContain("no transition");
    expect(Array.isArray(r.available_events)).toBe(true);
  });

  it("없는 상태 → error", async () => {
    const r = await run("transition", { current: "nonexistent", event: "START" });
    expect(r.error).toContain("unknown state");
  });

  it("current 미지정 → initial 사용", async () => {
    const r = await run("transition", { event: "START" });
    expect(r.from).toBe("idle");
  });
});

describe("StateMachineTool — validate", () => {
  it("유효한 머신 → valid=true, errors 없음", async () => {
    const r = await run("validate");
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("dead_end_states 검출", async () => {
    const machine_with_dead = JSON.stringify({
      initial: "start",
      states: [
        { name: "start", on: { GO: "end" } },
        { name: "end" }, // dead end
      ],
    });
    const r = JSON.parse(await tool.execute({ action: "validate", machine: machine_with_dead }));
    expect((r.warnings as Record<string, string[]>).dead_end_states).toContain("end");
  });

  it("unreachable_states 검출", async () => {
    const machine_with_unreachable = JSON.stringify({
      initial: "start",
      states: [
        { name: "start", on: { GO: "mid" } },
        { name: "mid", on: { DONE: "end" } },
        { name: "end" },
        { name: "orphan" }, // unreachable from initial
      ],
    });
    const r = JSON.parse(await tool.execute({ action: "validate", machine: machine_with_unreachable }));
    expect((r.warnings as Record<string, string[]>).unreachable_states).toContain("orphan");
  });

  it("invalid initial state → error", async () => {
    const bad_machine = JSON.stringify({
      initial: "nonexistent",
      states: [{ name: "idle" }],
    });
    const r = JSON.parse(await tool.execute({ action: "validate", machine: bad_machine }));
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).length).toBeGreaterThan(0);
  });

  it("unknown transition target → error", async () => {
    const bad_machine = JSON.stringify({
      initial: "start",
      states: [{ name: "start", on: { GO: "nonexistent_state" } }],
    });
    const r = JSON.parse(await tool.execute({ action: "validate", machine: bad_machine }));
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("unknown target"))).toBe(true);
  });
});

describe("StateMachineTool — visualize", () => {
  it("Mermaid 다이어그램 생성", async () => {
    const r = await run("visualize");
    expect(r.format).toBe("mermaid");
    const diagram = r.diagram as string;
    expect(diagram).toContain("stateDiagram-v2");
    expect(diagram).toContain("[*] --> idle");
    expect(diagram).toContain("idle --> running: START");
  });

  it("잘못된 machine → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "visualize", machine: "bad" }));
    expect(r.error).toBeDefined();
  });
});

describe("StateMachineTool — reachable", () => {
  it("초기 상태에서 도달 가능한 상태 목록", async () => {
    const r = await run("reachable");
    const reachable = r.reachable as string[];
    expect(reachable).toContain("idle");
    expect(reachable).toContain("running");
    expect(reachable).toContain("paused");
  });

  it("특정 상태에서 도달 가능한 상태", async () => {
    const r = await run("reachable", { current: "paused" });
    const reachable = r.reachable as string[];
    expect(reachable).toContain("running"); // paused → RESUME → running
  });

  it("잘못된 machine → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "reachable", machine: "bad" }));
    expect(r.error).toBeDefined();
  });
});

describe("StateMachineTool — history", () => {
  it("이벤트 시퀀스로 히스토리 시뮬레이션", async () => {
    const r = await run("history", { events: JSON.stringify(["START", "PAUSE", "RESUME"]) });
    expect(r.final_state).toBe("running");
    expect(r.steps).toBe(3);
    const history = r.history as Array<{ state: string; event: string; next: string }>;
    expect(history[0]).toEqual({ state: "idle", event: "START", next: "running" });
  });

  it("잘못된 이벤트 JSON → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "history", machine: SIMPLE_MACHINE, events: "invalid" }));
    expect(r.error).toContain("invalid events JSON");
  });

  it("없는 상태에서 전이 → error + 히스토리", async () => {
    const r = JSON.parse(await tool.execute({
      action: "history",
      machine: SIMPLE_MACHINE,
      current: "nonexistent",
      events: JSON.stringify(["START"]),
    }));
    expect(r.error).toContain("unknown state");
  });

  it("없는 이벤트로 전이 → error", async () => {
    const r = await run("history", { events: JSON.stringify(["INVALID_EVENT"]) });
    expect(r.error).toBeDefined();
  });

  it("빈 이벤트 시퀀스 → 초기 상태 유지", async () => {
    const r = await run("history", { events: "[]" });
    expect(r.final_state).toBe("idle");
    expect(r.steps).toBe(0);
  });
});

describe("StateMachineTool — 알 수 없는 액션", () => {
  it("unknown action → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "unknown_xyz", machine: SIMPLE_MACHINE }));
    expect(r.error).toContain("unknown action");
  });
});

describe("StateMachineTool — validate_params", () => {
  it("action 없으면 에러", () => {
    const errors = tool.validate_params({});
    expect(errors.some((e) => e.includes("action"))).toBe(true);
  });

  it("action 있으면 에러 없음", () => {
    const errors = tool.validate_params({ action: "define" });
    expect(errors).toHaveLength(0);
  });
});
