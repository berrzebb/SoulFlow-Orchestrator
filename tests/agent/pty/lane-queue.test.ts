import { describe, it, expect } from "vitest";
import { Lane, LaneQueue } from "@src/agent/pty/lane-queue.ts";

describe("Lane", () => {
  it("태스크를 순차적으로 실행한다", async () => {
    const lane = new Lane();
    const order: number[] = [];

    const a = lane.enqueue(async () => { order.push(1); return "a"; });
    const b = lane.enqueue(async () => { order.push(2); return "b"; });
    const c = lane.enqueue(async () => { order.push(3); return "c"; });

    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(await c).toBe("c");
    expect(order).toEqual([1, 2, 3]);
  });

  it("태스크 실패가 다른 태스크에 영향을 주지 않는다", async () => {
    const lane = new Lane();
    const a = lane.enqueue(async () => { throw new Error("fail"); });
    const b = lane.enqueue(async () => "ok");

    await expect(a).rejects.toThrow("fail");
    expect(await b).toBe("ok");
  });

  it("pending 카운트를 추적한다", async () => {
    const lane = new Lane();
    let resolve_fn: () => void;
    const blocker = new Promise<void>((r) => { resolve_fn = r; });

    const a = lane.enqueue(() => blocker);
    lane.enqueue(async () => {});
    // drain이 시작되면 첫 태스크는 실행 중이므로 pending은 남은 1개
    await new Promise((r) => setTimeout(r, 10));
    expect(lane.pending).toBe(1);

    resolve_fn!();
    await a;
  });
});

describe("LaneQueue", () => {
  it("같은 세션의 태스크를 직렬화한다", async () => {
    const lq = new LaneQueue();
    const order: number[] = [];

    const a = lq.execute("s1", async () => { order.push(1); });
    const b = lq.execute("s1", async () => { order.push(2); });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  it("다른 세션은 독립적으로 실행된다", async () => {
    const lq = new LaneQueue();
    const starts: string[] = [];

    let resolve_s1: () => void;
    const blocker = new Promise<void>((r) => { resolve_s1 = r; });

    const a = lq.execute("s1", async () => { starts.push("s1"); await blocker; });
    const b = lq.execute("s2", async () => { starts.push("s2"); });

    await b;
    expect(starts).toContain("s2");
    resolve_s1!();
    await a;
  });

  it("followup 메시지를 큐잉하고 drain한다", () => {
    const lq = new LaneQueue();
    lq.followup("s1", "msg1");
    lq.followup("s1", "msg2");

    const drained = lq.drain_followups("s1");
    expect(drained).toEqual(["msg1", "msg2"]);
    expect(lq.drain_followups("s1")).toEqual([]);
  });

  it("collect 메시지를 배치 결합한다", () => {
    const lq = new LaneQueue();
    lq.collect("s1", "a");
    lq.collect("s1", "b");
    lq.collect("s1", "c");

    expect(lq.drain_collected("s1")).toBe("a\n\nb\n\nc");
    expect(lq.drain_collected("s1")).toBeNull();
  });

  it("wait_for_followup — 즉시 사용 가능한 followup을 반환한다", async () => {
    const lq = new LaneQueue();
    lq.followup("s1", "immediate");

    const result = await lq.wait_for_followup("s1", 1000);
    expect(result).toEqual(["immediate"]);
  });

  it("wait_for_followup — 지연 도착한 followup을 대기 후 반환한다", async () => {
    const lq = new LaneQueue();

    // 100ms 후 followup 주입
    setTimeout(() => lq.followup("s1", "delayed"), 100);

    const result = await lq.wait_for_followup("s1", 2000);
    expect(result).toEqual(["delayed"]);
  });

  it("wait_for_followup — 타임아웃 시 null 반환", async () => {
    const lq = new LaneQueue();

    const result = await lq.wait_for_followup("s1", 300);
    expect(result).toBeNull();
  });

  it("clear로 세션 데이터를 정리한다", () => {
    const lq = new LaneQueue();
    lq.followup("s1", "x");
    lq.collect("s1", "y");
    lq.clear("s1");

    expect(lq.drain_followups("s1")).toEqual([]);
    expect(lq.drain_collected("s1")).toBeNull();
    expect(lq.session_count).toBe(0);
  });
});
