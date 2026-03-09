/**
 * classifier.ts — 키워드 휴리스틱 분류기 테스트.
 *
 * 대상:
 * - fast_classify(): builtin / identity / inquiry / once 분류
 * - classify_execution_mode(): fast_classify 래퍼 (logger 검증)
 * - parse_execution_mode(): JSON/단어 파싱
 * - detect_escalation(): NEED TASK LOOP / NEED AGENT LOOP
 * - is_once_escalation(), is_agent_escalation()
 */

import { describe, it, expect, vi } from "vitest";
import {
  classify_execution_mode,
  fast_classify,
  parse_execution_mode,
  detect_escalation,
  is_once_escalation,
  is_agent_escalation,
} from "@src/orchestration/classifier.js";
import type { ClassifierContext } from "@src/orchestration/classifier.js";
import type { Logger } from "@src/logger.js";

const noop_logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function ctx(overrides: Partial<ClassifierContext> = {}): ClassifierContext {
  return { ...overrides };
}

// ══════════════════════════════════════════════════
// fast_classify
// ══════════════════════════════════════════════════

describe("fast_classify — 휴리스틱 분류", () => {
  describe("기본 경로", () => {
    it("빈 문자열 → once", () => {
      expect(fast_classify("", ctx()).mode).toBe("once");
    });

    it("공백만 → once", () => {
      expect(fast_classify("   ", ctx()).mode).toBe("once");
    });

    it("일반 질문 → once", () => {
      expect(fast_classify("오늘 날씨 알려줘", ctx()).mode).toBe("once");
    });
  });

  describe("builtin: /커맨드", () => {
    it("/help → builtin, command='help'", () => {
      const r = fast_classify("/help", ctx());
      expect(r.mode).toBe("builtin");
      expect(r.command).toBe("help");
    });

    it("/task list → builtin, command='task', args='list'", () => {
      const r = fast_classify("/task list", ctx());
      expect(r.mode).toBe("builtin");
      expect(r.command).toBe("task");
      expect(r.args).toBe("list");
    });

    it("/cmd → args=undefined (인자 없음)", () => {
      const r = fast_classify("/cmd", ctx());
      expect(r.mode).toBe("builtin");
      expect(r.args).toBeUndefined();
    });
  });

  describe("identity: 봇 정체성 질문", () => {
    it("'너 누구야' → identity", () => {
      expect(fast_classify("너 누구야", ctx()).mode).toBe("identity");
    });

    it("'who are you' → identity", () => {
      expect(fast_classify("who are you", ctx()).mode).toBe("identity");
    });

    it("'소개해줘' → identity", () => {
      expect(fast_classify("소개해줘", ctx()).mode).toBe("identity");
    });
  });

  describe("inquiry: 활성 태스크 상태 조회", () => {
    const task_state: any = {
      taskId: "t1",
      title: "T",
      status: "in_progress",
      memory: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTurn: 1,
      objective: "",
      channel: "slack",
      chatId: "C1",
    };

    it("active_tasks 있음 + '상태' 키워드 → inquiry", () => {
      expect(fast_classify("작업 상태 어때?", ctx({ active_tasks: [task_state] })).mode).toBe("inquiry");
    });

    it("active_tasks 있음 + 'status' 키워드 → inquiry", () => {
      expect(fast_classify("what is the status", ctx({ active_tasks: [task_state] })).mode).toBe("inquiry");
    });

    it("active_tasks 없음 + '상태' 키워드 → once (inquiry 아님)", () => {
      expect(fast_classify("상태 알려줘", ctx()).mode).toBe("once");
    });

    it("active_tasks 빈 배열 → inquiry 미발동", () => {
      expect(fast_classify("진행 상황은?", ctx({ active_tasks: [] })).mode).toBe("once");
    });
  });
});

// ══════════════════════════════════════════════════
// classify_execution_mode (래퍼)
// ══════════════════════════════════════════════════

describe("classify_execution_mode — 래퍼", () => {
  it("logger.info 호출", async () => {
    const logger = { ...noop_logger, info: vi.fn() } as unknown as Logger;
    await classify_execution_mode("hello", ctx(), null, logger);
    expect(logger.info).toHaveBeenCalledWith("classify_result", expect.objectContaining({ source: "heuristic" }));
  });

  it("빈 task → once 반환", async () => {
    const result = await classify_execution_mode("", ctx(), null, noop_logger);
    expect(result.mode).toBe("once");
  });

  it("identity 키워드 → identity 반환", async () => {
    const result = await classify_execution_mode("introduce yourself", ctx(), null, noop_logger);
    expect(result.mode).toBe("identity");
  });
});

// ══════════════════════════════════════════════════
// parse_execution_mode
// ══════════════════════════════════════════════════

describe("parse_execution_mode — JSON/단어 파싱", () => {
  it("빈 문자열 → null", () => {
    expect(parse_execution_mode("")).toBeNull();
  });

  it("JSON {mode:'once'} → {mode:'once'}", () => {
    expect(parse_execution_mode('{"mode":"once"}')).toMatchObject({ mode: "once" });
  });

  it("JSON {mode:'agent'} → {mode:'agent'}", () => {
    expect(parse_execution_mode('{"mode":"agent"}')).toMatchObject({ mode: "agent" });
  });

  it("JSON {mode:'task'} → {mode:'task'}", () => {
    expect(parse_execution_mode('{"mode":"task"}')).toMatchObject({ mode: "task" });
  });

  it("JSON {mode:'inquiry'} → {mode:'inquiry'}", () => {
    expect(parse_execution_mode('{"mode":"inquiry"}')).toMatchObject({ mode: "inquiry" });
  });

  it("JSON {mode:'identity'} → {mode:'identity'}", () => {
    expect(parse_execution_mode('{"mode":"identity"}')).toMatchObject({ mode: "identity" });
  });

  it("JSON phase + workflow_id → {mode:'phase', workflow_id}", () => {
    const r = parse_execution_mode('{"mode":"phase","workflow_id":"wf-123"}');
    expect(r?.mode).toBe("phase");
    expect(r?.workflow_id).toBe("wf-123");
  });

  it("JSON phase + nodes 배열 → nodes 포함", () => {
    const r = parse_execution_mode('{"mode":"phase","nodes":["n1","n2"]}');
    expect(r?.mode).toBe("phase");
    expect(r?.nodes).toEqual(["n1", "n2"]);
  });

  it("JSON phase + workflow_id + nodes 둘 다 → 모두 포함", () => {
    const r = parse_execution_mode('{"mode":"phase","workflow_id":"wf-x","nodes":["a","b"]}');
    expect(r?.workflow_id).toBe("wf-x");
    expect(r?.nodes).toEqual(["a", "b"]);
  });

  it("JSON phase 빈 nodes → nodes 미포함", () => {
    const r = parse_execution_mode('{"mode":"phase","nodes":[]}');
    expect(r?.mode).toBe("phase");
    expect(r?.nodes).toBeUndefined();
  });

  it("JSON once + tools 배열 → tools 포함", () => {
    const r = parse_execution_mode('{"mode":"once","tools":["tool1","tool2"]}');
    expect(r?.mode).toBe("once");
    expect(r?.tools).toEqual(["tool1", "tool2"]);
  });

  it("JSON agent + tools → tools 포함", () => {
    const r = parse_execution_mode('{"mode":"agent","tools":["t1"]}');
    expect(r?.tools).toEqual(["t1"]);
  });

  it("JSON task + 빈 tools → tools 미포함", () => {
    const r = parse_execution_mode('{"mode":"task","tools":[]}');
    expect(r?.mode).toBe("task");
    expect(r?.tools).toBeUndefined();
  });

  it("JSON builtin + command → command 포함", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"help"}');
    expect(r?.mode).toBe("builtin");
    expect(r?.command).toBe("help");
  });

  it("JSON builtin + args → args 포함", () => {
    const r = parse_execution_mode('{"mode":"builtin","command":"task","args":"list all"}');
    expect(r?.args).toBe("list all");
  });

  it("JSON builtin command 없음 → null", () => {
    expect(parse_execution_mode('{"mode":"builtin"}')).toBeNull();
  });

  it("단어 'once' 포함 텍스트 → {mode:'once'}", () => {
    expect(parse_execution_mode("the mode is once")).toMatchObject({ mode: "once" });
  });

  it("단어 'task' 포함 텍스트 → {mode:'task'}", () => {
    expect(parse_execution_mode("use task mode")).toMatchObject({ mode: "task" });
  });

  it("단어 'phase' 포함 텍스트 → {mode:'phase'}", () => {
    expect(parse_execution_mode("run in phase mode")).toMatchObject({ mode: "phase" });
  });

  it("단어 'identity' 포함 텍스트 → {mode:'identity'}", () => {
    expect(parse_execution_mode("this is identity mode")).toMatchObject({ mode: "identity" });
  });

  it("알 수 없는 텍스트 → null", () => {
    expect(parse_execution_mode("some random text")).toBeNull();
  });

  it("잘못된 JSON은 단어 파싱 fallback", () => {
    const r = parse_execution_mode("{invalid} once mode");
    // 단어 파싱으로 'once' 추출
    expect(r?.mode).toBe("once");
  });
});

// ══════════════════════════════════════════════════
// detect_escalation
// ══════════════════════════════════════════════════

describe("detect_escalation — 에스컬레이션 감지", () => {
  it("NEED TASK LOOP (once 기본) → once_requires_task_loop", () => {
    expect(detect_escalation("NEED TASK LOOP")).toBe("once_requires_task_loop");
  });

  it("NEED TASK LOOP (agent) → agent_requires_task_loop", () => {
    expect(detect_escalation("NEED TASK LOOP", "agent")).toBe("agent_requires_task_loop");
  });

  it("NEED AGENT LOOP → once_requires_agent_loop", () => {
    expect(detect_escalation("NEED AGENT LOOP")).toBe("once_requires_agent_loop");
  });

  it("need_task_loop (소문자+언더스코어) → 감지됨", () => {
    expect(detect_escalation("need_task_loop")).toBe("once_requires_task_loop");
  });

  it("관련 없는 텍스트 → null", () => {
    expect(detect_escalation("일반 텍스트")).toBeNull();
  });
});

// ══════════════════════════════════════════════════
// is_once_escalation
// ══════════════════════════════════════════════════

describe("is_once_escalation", () => {
  it("once_requires_task_loop → true", () => {
    expect(is_once_escalation("once_requires_task_loop")).toBe(true);
  });

  it("once_requires_agent_loop → true", () => {
    expect(is_once_escalation("once_requires_agent_loop")).toBe(true);
  });

  it("agent_requires_task_loop → false", () => {
    expect(is_once_escalation("agent_requires_task_loop")).toBe(false);
  });

  it("null → false", () => { expect(is_once_escalation(null)).toBe(false); });
  it("undefined → false", () => { expect(is_once_escalation(undefined)).toBe(false); });
  it("다른 에러 → false", () => { expect(is_once_escalation("some_error")).toBe(false); });
});

// ══════════════════════════════════════════════════
// is_agent_escalation
// ══════════════════════════════════════════════════

describe("is_agent_escalation", () => {
  it("agent_requires_task_loop → true", () => {
    expect(is_agent_escalation("agent_requires_task_loop")).toBe(true);
  });

  it("once_requires_task_loop → false", () => {
    expect(is_agent_escalation("once_requires_task_loop")).toBe(false);
  });

  it("once_requires_agent_loop → false", () => {
    expect(is_agent_escalation("once_requires_agent_loop")).toBe(false);
  });

  it("null → false", () => { expect(is_agent_escalation(null)).toBe(false); });
  it("undefined → false", () => { expect(is_agent_escalation(undefined)).toBe(false); });
  it("다른 에러 → false", () => { expect(is_agent_escalation("some_error")).toBe(false); });
});
