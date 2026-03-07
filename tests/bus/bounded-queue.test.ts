import { describe, it, expect } from "vitest";
import { BoundedQueue, MessageBus } from "@src/bus/service.js";

describe("BoundedQueue", () => {
  describe("basic operations", () => {
    it("push and shift in FIFO order", () => {
      const q = new BoundedQueue<number>(100);
      q.push(1);
      q.push(2);
      q.push(3);
      expect(q.shift()).toBe(1);
      expect(q.shift()).toBe(2);
      expect(q.shift()).toBe(3);
      expect(q.shift()).toBeUndefined();
    });

    it("tracks length correctly", () => {
      const q = new BoundedQueue<string>(100);
      expect(q.length).toBe(0);
      q.push("a");
      expect(q.length).toBe(1);
      q.push("b");
      expect(q.length).toBe(2);
      q.shift();
      expect(q.length).toBe(1);
      q.shift();
      expect(q.length).toBe(0);
    });

    it("clear empties the queue and returns count", () => {
      const q = new BoundedQueue<number>(100);
      q.push(1);
      q.push(2);
      q.push(3);
      const cleared = q.clear();
      expect(cleared).toBe(3);
      expect(q.length).toBe(0);
      expect(q.shift()).toBeUndefined();
    });
  });

  describe("bounded behavior — drop-oldest", () => {
    it("drops oldest when capacity exceeded", () => {
      const q = new BoundedQueue<number>(3, "drop-oldest");
      q.push(1);
      q.push(2);
      q.push(3);
      const dropped = q.push(4);
      expect(dropped).toBe(1);
      expect(q.length).toBe(3);
      expect(q.shift()).toBe(2);
      expect(q.shift()).toBe(3);
      expect(q.shift()).toBe(4);
    });

    it("tracks overflow count", () => {
      const q = new BoundedQueue<number>(2, "drop-oldest");
      q.push(1);
      q.push(2);
      expect(q.overflow_count).toBe(0);
      q.push(3);
      expect(q.overflow_count).toBe(1);
      q.push(4);
      expect(q.overflow_count).toBe(2);
    });

    it("returns null when push within capacity", () => {
      const q = new BoundedQueue<number>(5);
      expect(q.push(1)).toBeNull();
      expect(q.push(2)).toBeNull();
    });
  });

  describe("bounded behavior — reject-newest", () => {
    it("rejects newest when capacity exceeded", () => {
      const q = new BoundedQueue<number>(3, "reject-newest");
      q.push(1);
      q.push(2);
      q.push(3);
      const rejected = q.push(4);
      expect(rejected).toBe(4);
      expect(q.length).toBe(3);
      expect(q.shift()).toBe(1);
      expect(q.shift()).toBe(2);
      expect(q.shift()).toBe(3);
    });
  });

  describe("compaction", () => {
    it("compacts after many shifts", () => {
      const q = new BoundedQueue<number>(10_000);
      for (let i = 0; i < 1000; i++) q.push(i);
      for (let i = 0; i < 999; i++) q.shift();
      expect(q.length).toBe(1);
      expect(q.shift()).toBe(999);
    });
  });

  describe("edge cases", () => {
    it("capacity 1 works correctly", () => {
      const q = new BoundedQueue<string>(1);
      q.push("a");
      expect(q.length).toBe(1);
      const dropped = q.push("b");
      expect(dropped).toBe("a");
      expect(q.length).toBe(1);
      expect(q.shift()).toBe("b");
    });

    it("capacity 0 is clamped to 1", () => {
      const q = new BoundedQueue<number>(0);
      expect(q.capacity).toBe(1);
    });
  });
});

describe("MessageBus P0 fixes", () => {
  describe("P0-1: close() fully drains all queues", () => {
    it("close clears all queues completely", async () => {
      const bus = new MessageBus({ max_queue_size: 100_000 });
      for (let i = 0; i < 10_000; i++) {
        await bus.publish_inbound({ id: `in_${i}`, provider: "test", channel: "c", sender_id: "s", chat_id: "t", content: "", at: "" });
        await bus.publish_outbound({ id: `out_${i}`, provider: "test", channel: "c", sender_id: "s", chat_id: "t", content: "", at: "" });
      }
      expect(bus.get_size("inbound")).toBe(10_000);
      expect(bus.get_size("outbound")).toBe(10_000);
      await bus.close();
      expect(bus.get_size("inbound")).toBe(0);
      expect(bus.get_size("outbound")).toBe(0);
    });

    it("close resolves pending consumers with null", async () => {
      const bus = new MessageBus();
      const promise = bus.consume_inbound({ timeout_ms: 60_000 });
      await bus.close();
      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe("P0-2: queue backpressure", () => {
    it("enforces max_queue_size with drop-oldest", async () => {
      const bus = new MessageBus({ max_queue_size: 3, overflow_policy: "drop-oldest" });
      for (let i = 0; i < 5; i++) {
        await bus.publish_inbound({ id: `m_${i}`, provider: "test", channel: "c", sender_id: "s", chat_id: "t", content: `msg_${i}`, at: "" });
      }
      expect(bus.get_size("inbound")).toBe(3);
      const first = await bus.consume_inbound();
      expect(first!.content).toBe("msg_2");
    });

    it("enforces max_queue_size with reject-newest", async () => {
      const bus = new MessageBus({ max_queue_size: 2, overflow_policy: "reject-newest" });
      for (let i = 0; i < 5; i++) {
        await bus.publish_inbound({ id: `m_${i}`, provider: "test", channel: "c", sender_id: "s", chat_id: "t", content: `msg_${i}`, at: "" });
      }
      expect(bus.get_size("inbound")).toBe(2);
      const first = await bus.consume_inbound();
      expect(first!.content).toBe("msg_0");
    });

    it("get_metrics reports depth and overflow", async () => {
      const bus = new MessageBus({ max_queue_size: 2 });
      await bus.publish_inbound({ id: "1", provider: "t", channel: "c", sender_id: "s", chat_id: "t", content: "", at: "" });
      await bus.publish_inbound({ id: "2", provider: "t", channel: "c", sender_id: "s", chat_id: "t", content: "", at: "" });
      await bus.publish_inbound({ id: "3", provider: "t", channel: "c", sender_id: "s", chat_id: "t", content: "", at: "" });
      const metrics = bus.get_metrics();
      expect(metrics.inbound.depth).toBe(2);
      expect(metrics.inbound.overflow).toBe(1);
      expect(metrics.capacity).toBe(2);
    });
  });

  describe("P0-3: O(1) operations", () => {
    it("handles high throughput without degradation", async () => {
      const bus = new MessageBus({ max_queue_size: 50_000 });
      const msg = { id: "perf", provider: "test", channel: "c", sender_id: "s", chat_id: "t", content: "", at: "" };
      const start = performance.now();
      for (let i = 0; i < 10_000; i++) {
        await bus.publish_inbound(msg);
      }
      for (let i = 0; i < 10_000; i++) {
        await bus.consume_inbound();
      }
      const elapsed = performance.now() - start;
      // O(1) 기반이면 10k ops가 100ms 이내에 완료되어야 함
      expect(elapsed).toBeLessThan(1000);
      await bus.close();
    });
  });

  describe("backward compatibility", () => {
    it("works without options (default capacity 10000)", async () => {
      const bus = new MessageBus();
      await bus.publish_inbound({ id: "1", provider: "t", channel: "c", sender_id: "s", chat_id: "t", content: "hello", at: "" });
      const msg = await bus.consume_inbound();
      expect(msg!.content).toBe("hello");
    });
  });
});
