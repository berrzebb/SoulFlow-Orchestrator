/**
 * WebhookTool — register/list/remove/get_recent 커버리지.
 * 실제 HTTP 서버를 사용하는 통합 스타일 테스트.
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebhookTool } from "@src/agent/tools/webhook.js";

// 테스트마다 새 인스턴스 (서버도 분리)
function make_tool() { return new WebhookTool(); }

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("WebhookTool — 메타데이터", () => {
  it("name = webhook", () => expect(make_tool().name).toBe("webhook"));
  it("category = external", () => expect(make_tool().category).toBe("external"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// register
// ══════════════════════════════════════════

describe("WebhookTool — register", () => {
  it("path 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "register" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("path");
  });

  it("/ 없는 path → Error", async () => {
    const r = await make_tool().execute({ action: "register", path: "noslash" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("path");
  });

  it("정상 path → id/port/url 반환", async () => {
    const tool = make_tool();
    try {
      const r = JSON.parse(await tool.execute({ action: "register", path: "/hooks/test" }));
      expect(r.id).toMatch(/^wh_/);
      expect(r.port).toBeGreaterThan(0);
      expect(r.url).toContain("/hooks/test");
      expect(r.method).toBe("POST");
    } finally {
      // cleanup: remove all hooks
      const list = JSON.parse(await tool.execute({ action: "list" }));
      for (const hook of list.webhooks) {
        await tool.execute({ action: "remove", webhook_id: hook.id });
      }
    }
  });

  it("method=GET 지정", async () => {
    const tool = make_tool();
    try {
      const r = JSON.parse(await tool.execute({ action: "register", path: "/hooks/get", method: "GET" }));
      expect(r.method).toBe("GET");
    } finally {
      const list = JSON.parse(await tool.execute({ action: "list" }));
      for (const hook of list.webhooks) {
        await tool.execute({ action: "remove", webhook_id: hook.id });
      }
    }
  });

  it("두 번째 등록 → 같은 서버 재사용 (port 동일)", async () => {
    const tool = make_tool();
    try {
      const r1 = JSON.parse(await tool.execute({ action: "register", path: "/hooks/a" }));
      const r2 = JSON.parse(await tool.execute({ action: "register", path: "/hooks/b" }));
      expect(r1.port).toBe(r2.port);
    } finally {
      const list = JSON.parse(await tool.execute({ action: "list" }));
      for (const hook of list.webhooks) {
        await tool.execute({ action: "remove", webhook_id: hook.id });
      }
    }
  });
});

// ══════════════════════════════════════════
// list
// ══════════════════════════════════════════

describe("WebhookTool — list", () => {
  it("빈 상태 → webhooks=[] port=null", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "list" }));
    expect(r.webhooks).toEqual([]);
    expect(r.port).toBeNull();
  });

  it("등록 후 → webhooks 1개", async () => {
    const tool = make_tool();
    try {
      await tool.execute({ action: "register", path: "/hooks/list-test" });
      const r = JSON.parse(await tool.execute({ action: "list" }));
      expect(r.webhooks).toHaveLength(1);
      expect(r.webhooks[0].path).toBe("/hooks/list-test");
    } finally {
      const list = JSON.parse(await tool.execute({ action: "list" }));
      for (const hook of list.webhooks) {
        await tool.execute({ action: "remove", webhook_id: hook.id });
      }
    }
  });
});

// ══════════════════════════════════════════
// remove
// ══════════════════════════════════════════

describe("WebhookTool — remove", () => {
  it("webhook_id 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "remove" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("webhook_id");
  });

  it("존재하지 않는 id → Error", async () => {
    const r = await make_tool().execute({ action: "remove", webhook_id: "wh_nonexist" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("등록 후 제거 → Removed 메시지", async () => {
    const tool = make_tool();
    const reg = JSON.parse(await tool.execute({ action: "register", path: "/hooks/remove-test" }));
    const r = await tool.execute({ action: "remove", webhook_id: reg.id });
    expect(String(r)).toContain("Removed");
    expect(String(r)).toContain(reg.id);
  });

  it("마지막 hook 제거 → 서버 닫힘 (list port=null)", async () => {
    const tool = make_tool();
    const reg = JSON.parse(await tool.execute({ action: "register", path: "/hooks/last" }));
    await tool.execute({ action: "remove", webhook_id: reg.id });
    const list = JSON.parse(await tool.execute({ action: "list" }));
    expect(list.port).toBeNull();
  });
});

// ══════════════════════════════════════════
// get_recent
// ══════════════════════════════════════════

describe("WebhookTool — get_recent", () => {
  it("webhook_id 없음 → Error", async () => {
    const r = await make_tool().execute({ action: "get_recent" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("webhook_id");
  });

  it("존재하지 않는 id → Error", async () => {
    const r = await make_tool().execute({ action: "get_recent", webhook_id: "wh_none" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("not found");
  });

  it("등록 직후 → requests=[]", async () => {
    const tool = make_tool();
    try {
      const reg = JSON.parse(await tool.execute({ action: "register", path: "/hooks/recent-test" }));
      const r = JSON.parse(await tool.execute({ action: "get_recent", webhook_id: reg.id }));
      expect(r.requests).toEqual([]);
    } finally {
      const list = JSON.parse(await tool.execute({ action: "list" }));
      for (const hook of list.webhooks) {
        await tool.execute({ action: "remove", webhook_id: hook.id });
      }
    }
  });

  it("실제 HTTP 요청 후 → request 기록됨", async () => {
    const tool = make_tool();
    try {
      const reg = JSON.parse(await tool.execute({ action: "register", path: "/hooks/receive" }));
      const { port } = reg;

      // 실제 POST 요청
      await fetch(`http://localhost:${port}/hooks/receive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "test" }),
      });

      // 약간의 비동기 처리 대기
      await new Promise(r => setTimeout(r, 20));

      const recent = JSON.parse(await tool.execute({ action: "get_recent", webhook_id: reg.id }));
      expect(recent.requests.length).toBeGreaterThan(0);
      expect(recent.requests[0].method).toBe("POST");
    } finally {
      const list = JSON.parse(await tool.execute({ action: "list" }));
      for (const hook of list.webhooks) {
        await tool.execute({ action: "remove", webhook_id: hook.id });
      }
    }
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("WebhookTool — unsupported action", () => {
  it("bogus action → Error", async () => {
    const r = await make_tool().execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
