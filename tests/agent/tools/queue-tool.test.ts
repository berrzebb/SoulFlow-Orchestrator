/**
 * QueueTool 커버리지 — FIFO/LIFO/Priority 큐 모든 작업.
 */
import { describe, it, expect } from "vitest";
import { QueueTool } from "@src/agent/tools/queue.js";

function make_tool(): QueueTool {
  return new QueueTool();
}

async function run(tool: QueueTool, op: string, extra?: Record<string, unknown>): Promise<string> {
  return tool.execute({ operation: op, ...extra });
}

describe("QueueTool — 메타데이터", () => {
  it("name = queue", () => expect(make_tool().name).toBe("queue"));
  it("category = memory", () => expect(make_tool().category).toBe("memory"));
  it("to_schema: function 형식", () => expect(make_tool().to_schema().type).toBe("function"));
});

describe("QueueTool — enqueue/dequeue (FIFO)", () => {
  it("enqueue → 크기 반환", async () => {
    const tool = make_tool();
    const r = await run(tool, "enqueue", { queue: "q1", value: "first" });
    expect(r).toContain('"q1"');
    expect(r).toContain("size: 1");
  });

  it("dequeue: FIFO 순서 확인", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "fifo", value: "first" });
    await run(tool, "enqueue", { queue: "fifo", value: "second" });
    const item = await run(tool, "dequeue", { queue: "fifo" });
    expect(item).toBe("first");
  });

  it("dequeue: 빈 큐 → Error", async () => {
    const tool = make_tool();
    const r = await run(tool, "dequeue", { queue: "empty_q" });
    expect(r).toContain("Error");
  });
});

describe("QueueTool — LIFO 모드", () => {
  it("lifo: 마지막 항목이 먼저 나옴", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "lifo_q", value: "first", mode: "lifo" });
    await run(tool, "enqueue", { queue: "lifo_q", value: "second" });
    const item = await run(tool, "dequeue", { queue: "lifo_q" });
    expect(item).toBe("second");
  });

  it("lifo peek: 마지막 항목 확인", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "lq", value: "a", mode: "lifo" });
    await run(tool, "enqueue", { queue: "lq", value: "b" });
    const item = await run(tool, "peek", { queue: "lq" });
    expect(item).toBe("b");
  });
});

describe("QueueTool — Priority 모드", () => {
  it("priority 낮은 순서로 정렬", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "pq", value: "low", priority: 90, mode: "priority" });
    await run(tool, "enqueue", { queue: "pq", value: "high", priority: 10 });
    const item = await run(tool, "dequeue", { queue: "pq" });
    expect(item).toBe("high"); // priority 10 < 90, 먼저 나옴
  });
});

describe("QueueTool — peek", () => {
  it("peek: FIFO 첫 번째 항목 확인 (삭제 없음)", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "pq2", value: "peek-me" });
    await run(tool, "enqueue", { queue: "pq2", value: "second" });
    const item = await run(tool, "peek", { queue: "pq2" });
    expect(item).toBe("peek-me");
    // peek 후 크기 변화 없음
    const size = JSON.parse(await run(tool, "size", { queue: "pq2" }));
    expect(size.size).toBe(2);
  });

  it("peek: 빈 큐 → Error", async () => {
    const r = await run(make_tool(), "peek", { queue: "empty" });
    expect(r).toContain("Error");
  });
});

describe("QueueTool — size", () => {
  it("size: 큐 없음 → size=0", async () => {
    const r = JSON.parse(await run(make_tool(), "size", { queue: "none" }));
    expect(r.size).toBe(0);
    expect(r.mode).toBe("none");
  });

  it("size: 큐 있음 → 정확한 크기", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "sq", value: "x" });
    await run(tool, "enqueue", { queue: "sq", value: "y" });
    const r = JSON.parse(await run(tool, "size", { queue: "sq" }));
    expect(r.size).toBe(2);
  });
});

describe("QueueTool — drain", () => {
  it("drain: 모든 항목 추출", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "dq", value: "a" });
    await run(tool, "enqueue", { queue: "dq", value: "b" });
    await run(tool, "enqueue", { queue: "dq", value: "c" });
    const r = JSON.parse(await run(tool, "drain", { queue: "dq" }));
    expect(r.drained).toEqual(["a", "b", "c"]);
    expect(r.remaining).toBe(0);
  });

  it("drain: count 제한", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "dq2", value: "a" });
    await run(tool, "enqueue", { queue: "dq2", value: "b" });
    await run(tool, "enqueue", { queue: "dq2", value: "c" });
    const r = JSON.parse(await run(tool, "drain", { queue: "dq2", count: 2 }));
    expect(r.drained).toHaveLength(2);
    expect(r.remaining).toBe(1);
  });

  it("drain: 빈 큐 → drained 빈 배열", async () => {
    const r = JSON.parse(await run(make_tool(), "drain", { queue: "empty_drain" }));
    expect(r.drained).toHaveLength(0);
  });

  it("drain lifo: 역순으로 추출", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "ldq", value: "first", mode: "lifo" });
    await run(tool, "enqueue", { queue: "ldq", value: "second" });
    const r = JSON.parse(await run(tool, "drain", { queue: "ldq" }));
    expect(r.drained[0]).toBe("second"); // LIFO: last in, first out
  });
});

describe("QueueTool — list", () => {
  it("list: 큐 없음 → no queues 메시지", async () => {
    const r = await run(make_tool(), "list", {});
    expect(r).toContain("no queues");
  });

  it("list: 큐 있음 → 목록 반환", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "list_q", value: "x" });
    const list = JSON.parse(await run(tool, "list", {}));
    expect(Array.isArray(list)).toBe(true);
    expect(list[0].name).toBe("list_q");
  });
});

describe("QueueTool — clear/delete", () => {
  it("clear: 큐 비우기", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "cl_q", value: "x" });
    const r = await run(tool, "clear", { queue: "cl_q" });
    expect(r).toContain("Cleared");
    const size = JSON.parse(await run(tool, "size", { queue: "cl_q" }));
    expect(size.size).toBe(0);
  });

  it("clear: 없는 큐 → not found", async () => {
    const r = await run(make_tool(), "clear", { queue: "not_exist" });
    expect(r).toContain("not found");
  });

  it("delete: 큐 삭제 성공", async () => {
    const tool = make_tool();
    await run(tool, "enqueue", { queue: "del_q", value: "x" });
    const r = await run(tool, "delete", { queue: "del_q" });
    expect(r).toContain("Deleted");
  });

  it("delete: 없는 큐 → not found", async () => {
    const r = await run(make_tool(), "delete", { queue: "none" });
    expect(r).toContain("not found");
  });
});

describe("QueueTool — 오류 케이스", () => {
  it("지원하지 않는 operation → Error", async () => {
    const r = await run(make_tool(), "invalid_op", {});
    expect(r).toContain("Error");
    expect(r).toContain("unsupported");
  });

  it("value가 최대 크기 초과 → Error", async () => {
    const tool = make_tool();
    const huge = "x".repeat(1024 * 65);
    const r = await run(tool, "enqueue", { queue: "big_q", value: huge });
    expect(r).toContain("Error");
    expect(r).toContain("exceeds");
  });
});
