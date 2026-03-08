/**
 * WebhookStore — push/get/pending_count/cleanup 테스트.
 */
import { describe, it, expect } from "vitest";
import { WebhookStore, type WebhookPayload } from "../../src/services/webhook-store.service.js";

function make_payload(method = "POST", age_ms = 0): WebhookPayload {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: { data: "test" },
    query: {},
    received_at: new Date(Date.now() - age_ms).toISOString(),
  };
}

describe("WebhookStore", () => {
  it("push + get: FIFO 순서로 소비", async () => {
    const store = new WebhookStore();
    store.push("/hooks/test", make_payload("POST"));
    store.push("/hooks/test", make_payload("PUT"));
    const first = await store.get("/hooks/test");
    expect(first!.method).toBe("POST");
    const second = await store.get("/hooks/test");
    expect(second!.method).toBe("PUT");
  });

  it("get: 빈 큐에서 null 반환", async () => {
    const store = new WebhookStore();
    expect(await store.get("/empty")).toBeNull();
  });

  it("push: 경로 정규화 — 슬래시 없는 경로에 자동 추가", async () => {
    const store = new WebhookStore();
    store.push("hooks/test", make_payload());
    const result = await store.get("/hooks/test");
    expect(result).not.toBeNull();
  });

  it("push: 큐 크기 제한 (MAX_QUEUE_SIZE=100)", () => {
    const store = new WebhookStore();
    for (let i = 0; i < 110; i++) {
      store.push("/overflow", make_payload("POST"));
    }
    expect(store.pending_count("/overflow")).toBe(100);
  });

  it("pending_count: 경로별 대기 수 반환", () => {
    const store = new WebhookStore();
    store.push("/a", make_payload());
    store.push("/a", make_payload());
    store.push("/b", make_payload());
    expect(store.pending_count("/a")).toBe(2);
    expect(store.pending_count("/b")).toBe(1);
    expect(store.pending_count("/c")).toBe(0);
  });

  it("get: TTL 초과 페이로드 스킵", async () => {
    const store = new WebhookStore();
    // 31분 전 데이터 → TTL(30분) 초과
    store.push("/expired", make_payload("POST", 31 * 60 * 1000));
    store.push("/expired", make_payload("GET", 0));
    const result = await store.get("/expired");
    expect(result!.method).toBe("GET");
  });

  it("cleanup: 오래된 데이터 정리", () => {
    const store = new WebhookStore();
    store.push("/old", make_payload("POST", 31 * 60 * 1000));
    store.push("/new", make_payload("POST", 0));
    store.cleanup();
    expect(store.pending_count("/old")).toBe(0);
    expect(store.pending_count("/new")).toBe(1);
  });
});
