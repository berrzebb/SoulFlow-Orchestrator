/**
 * RetrieverTool / RateLimitTool / OAuthFetchTool — 미커버 분기 보충.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RetrieverTool } from "@src/agent/tools/retriever.js";
import { RateLimitTool } from "@src/agent/tools/rate-limit.js";
import { OAuthFetchTool } from "@src/agent/tools/oauth-fetch.js";

// ══════════════════════════════════════════
// RetrieverTool
// ══════════════════════════════════════════

let fetch_mock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetch_mock = vi.fn();
  vi.stubGlobal("fetch", fetch_mock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RetrieverTool — http action", () => {
  it("url 없음 → Error: url is required", async () => {
    const r = await new RetrieverTool().execute({ action: "http", query: "test" });
    expect(r).toContain("url is required");
  });

  it("http 성공 → results 배열 반환", async () => {
    fetch_mock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ title: "Result A" }, { title: "Result B" }],
    });
    const r = JSON.parse(await new RetrieverTool().execute({ action: "http", query: "test", url: "https://api.example.com/search", top_k: 2 }));
    expect(r.results).toHaveLength(2);
    expect(r.source).toBe("http");
  });

  it("http 응답이 배열이 아님 → [body] 래핑", async () => {
    fetch_mock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ single: "result" }),
    });
    const r = JSON.parse(await new RetrieverTool().execute({ action: "http", query: "test", url: "https://api.example.com/item" }));
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toEqual({ single: "result" });
  });

  it("http 실패 → Error: HTTP 상태", async () => {
    fetch_mock.mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    const r = await new RetrieverTool().execute({ action: "http", query: "test", url: "https://api.example.com/search" });
    expect(r).toContain("HTTP 503");
  });

  it("url에 ? 포함 시 & 구분자 사용", async () => {
    let captured_url = "";
    fetch_mock.mockImplementationOnce(async (url: string) => {
      captured_url = url;
      return { ok: true, json: async () => [] };
    });
    await new RetrieverTool().execute({ action: "http", query: "hello", url: "https://api.example.com/search?page=1" });
    expect(captured_url).toContain("page=1&q=hello");
  });
});

describe("RetrieverTool — memory action", () => {
  it("데이터에서 쿼리 매칭 → results 포함", async () => {
    const data = JSON.stringify({ name: "Alice", job: "Engineer" });
    const r = JSON.parse(await new RetrieverTool().execute({ action: "memory", query: "engineer", data }));
    expect(r.results.length).toBeGreaterThanOrEqual(1);
    expect(r.source).toBe("memory");
  });

  it("매칭 없음 → 빈 results", async () => {
    const data = JSON.stringify({ name: "Alice" });
    const r = JSON.parse(await new RetrieverTool().execute({ action: "memory", query: "xyz_nonexistent", data }));
    expect(r.results).toHaveLength(0);
  });

  it("data가 JSON 아님 → Error", async () => {
    const r = await new RetrieverTool().execute({ action: "memory", query: "test", data: "invalid json" });
    expect(r).toContain("Error");
  });

  it("key 매칭으로도 결과 반환", async () => {
    const data = JSON.stringify({ alice_info: "some value" });
    const r = JSON.parse(await new RetrieverTool().execute({ action: "memory", query: "alice", data }));
    expect(r.results.length).toBeGreaterThanOrEqual(1);
  });

  it("object value JSON 직렬화", async () => {
    const data = JSON.stringify({ config: { theme: "dark", language: "english" } });
    const r = JSON.parse(await new RetrieverTool().execute({ action: "memory", query: "dark", data }));
    expect(r.results.length).toBeGreaterThanOrEqual(1);
  });
});

describe("RetrieverTool — vector action", () => {
  it("collection 없음 → Error", async () => {
    const r = await new RetrieverTool().execute({ action: "vector", query: "test" });
    expect(r).toContain("collection is required");
  });

  it("collection 지정 → 빈 results + note 포함", async () => {
    const r = JSON.parse(await new RetrieverTool().execute({ action: "vector", query: "test", collection: "my_col" }));
    expect(r.results).toHaveLength(0);
    expect(r.source).toBe("vector");
    expect(r.note).toContain("vector_store");
  });

  it("min_score 포함", async () => {
    const r = JSON.parse(await new RetrieverTool().execute({ action: "vector", query: "test", collection: "col", min_score: 0.8 }));
    expect(r.min_score).toBe(0.8);
  });
});

describe("RetrieverTool — unsupported action", () => {
  it("unknown action → Error", async () => {
    const r = await new RetrieverTool().execute({ action: "unknown", query: "test" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// RateLimitTool
// ══════════════════════════════════════════

// 각 테스트는 독립적인 key 사용
const uid = () => `rl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("RateLimitTool — check", () => {
  it("check → allowed=true", async () => {
    const tool = new RateLimitTool();
    const r = JSON.parse(await tool.execute({ action: "check", key: uid(), max_requests: 10 }));
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(10);
  });

  it("check sliding_window → allowed 상태 반환", async () => {
    const tool = new RateLimitTool();
    const r = JSON.parse(await tool.execute({ action: "check", key: uid(), algorithm: "sliding_window", max_requests: 5 }));
    expect(typeof r.allowed).toBe("boolean");
  });
});

describe("RateLimitTool — consume", () => {
  it("consume token_bucket 성공 → consumed=true", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    const r = JSON.parse(await tool.execute({ action: "consume", key, max_requests: 10 }));
    expect(r.consumed).toBe(true);
    expect(r.remaining).toBe(9);
  });

  it("consume token_bucket 부족 → consumed=false + retry_after", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    // 1개만 허용, 이미 소진
    for (let i = 0; i < 1; i++) {
      await tool.execute({ action: "consume", key, max_requests: 1, window_ms: 60000 });
    }
    const r = JSON.parse(await tool.execute({ action: "consume", key, max_requests: 1, window_ms: 60000 }));
    expect(r.consumed).toBe(false);
    expect(typeof r.retry_after_ms).toBe("number");
  });

  it("consume sliding_window 성공 → consumed=true", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    const r = JSON.parse(await tool.execute({ action: "consume", key, algorithm: "sliding_window", max_requests: 5 }));
    expect(r.consumed).toBe(true);
  });

  it("consume sliding_window 한도 초과 → consumed=false + retry_after_ms", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    for (let i = 0; i < 2; i++) {
      await tool.execute({ action: "consume", key, algorithm: "sliding_window", max_requests: 2, window_ms: 60000 });
    }
    const r = JSON.parse(await tool.execute({ action: "consume", key, algorithm: "sliding_window", max_requests: 2, window_ms: 60000 }));
    expect(r.consumed).toBe(false);
    expect(r.retry_after_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("RateLimitTool — status", () => {
  it("status 없는 key → exists=false", async () => {
    const tool = new RateLimitTool();
    const r = JSON.parse(await tool.execute({ action: "status", key: `nonexistent-${uid()}` }));
    expect(r.exists).toBe(false);
  });

  it("status 있는 key → exists=true + remaining", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    await tool.execute({ action: "consume", key, max_requests: 10 });
    const r = JSON.parse(await tool.execute({ action: "status", key }));
    expect(r.exists).toBe(true);
    expect(r.remaining).toBeLessThanOrEqual(10);
  });
});

describe("RateLimitTool — reset / list", () => {
  it("reset 특정 key → reset=true", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    await tool.execute({ action: "consume", key, max_requests: 5 });
    const r = JSON.parse(await tool.execute({ action: "reset", key }));
    expect(r.reset).toBe(true);
    expect(r.key).toBe(key);
  });

  it("reset * → 전체 초기화", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    await tool.execute({ action: "consume", key, max_requests: 5 });
    const r = JSON.parse(await tool.execute({ action: "reset", key: "*" }));
    expect(r.reset).toBe(true);
    expect(typeof r.count).toBe("number");
  });

  it("list → buckets 배열 반환", async () => {
    const tool = new RateLimitTool();
    const key = uid();
    await tool.execute({ action: "consume", key, max_requests: 5 });
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(Array.isArray(r.buckets)).toBe(true);
  });

  it("unsupported action → Error", async () => {
    const tool = new RateLimitTool();
    const r = await tool.execute({ action: "fly" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// OAuthFetchTool — 미커버 분기 보충
// ══════════════════════════════════════════

function make_store(overrides?: Record<string, unknown>) {
  return {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    upsert: vi.fn(),
    delete: vi.fn(),
    update_settings: vi.fn().mockReturnValue(false),
    update_expires_at: vi.fn(),
    is_expired: vi.fn().mockReturnValue(false),
    get_access_token: vi.fn().mockResolvedValue(null),
    get_refresh_token: vi.fn().mockResolvedValue(null),
    get_client_id: vi.fn().mockResolvedValue("client-id"),
    get_client_secret: vi.fn().mockResolvedValue("client-secret"),
    set_tokens: vi.fn(),
    load_presets: vi.fn().mockReturnValue([]),
    save_preset: vi.fn(),
    remove_preset: vi.fn().mockReturnValue(false),
    ...overrides,
  } as any;
}

function make_flow(overrides?: Record<string, unknown>) {
  return {
    get_valid_access_token: vi.fn().mockResolvedValue({ token: "my-token", error: null }),
    refresh_token: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn(),
    ...overrides,
  } as any;
}

describe("OAuthFetchTool — list action", () => {
  it("list → 연동 목록 반환", async () => {
    const store = make_store({
      list: vi.fn().mockReturnValue([
        { instance_id: "gh", service_type: "github", label: "GitHub", enabled: true, scopes: ["read:user"], expires_at: "2030-01-01" },
      ]),
    });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(Array.isArray(r)).toBe(true);
    expect(r[0].service_id).toBe("gh");
    expect(r[0].connected).toBe(true);
  });

  it("expires_at 없음 → connected=false", async () => {
    const store = make_store({
      list: vi.fn().mockReturnValue([
        { instance_id: "gh", service_type: "github", label: "GitHub", enabled: true, scopes: [], expires_at: null },
      ]),
    });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(r[0].connected).toBe(false);
  });
});

describe("OAuthFetchTool — get_token action", () => {
  it("service_id 없음 → Error: service_id is required", async () => {
    const tool = new OAuthFetchTool(make_store(), make_flow());
    const r = await tool.execute({ action: "get_token" });
    expect(r).toContain("service_id is required");
  });

  it("integration 없음 → Error: not found", async () => {
    const tool = new OAuthFetchTool(make_store(), make_flow());
    const r = await tool.execute({ action: "get_token", service_id: "nonexistent" });
    expect(r).toContain("not found");
  });

  it("integration disabled → Error: disabled", async () => {
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: false }) });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = await tool.execute({ action: "get_token", service_id: "gh" });
    expect(r).toContain("disabled");
  });

  it("token 없음 → Error: no valid access token", async () => {
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true, service_type: "github" }) });
    const flow = make_flow({ get_valid_access_token: vi.fn().mockResolvedValue({ token: null, error: "token_expired" }) });
    const tool = new OAuthFetchTool(store, flow);
    const r = await tool.execute({ action: "get_token", service_id: "gh" });
    expect(r).toContain("no valid access token");
  });

  it("정상 토큰 반환", async () => {
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true, service_type: "github" }) });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = JSON.parse(await tool.execute({ action: "get_token", service_id: "gh" }));
    expect(r.access_token).toBe("my-token");
  });
});

describe("OAuthFetchTool — fetch action", () => {
  it("service_id 없음 → Error", async () => {
    const tool = new OAuthFetchTool(make_store(), make_flow());
    const r = await tool.execute({ action: "fetch", url: "https://api.github.com/user" });
    expect(r).toContain("service_id is required");
  });

  it("url 없음 → Error", async () => {
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true }) });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = await tool.execute({ action: "fetch", service_id: "gh" });
    expect(r).toContain("Error");
  });

  it("integration 없음 → Error: not found", async () => {
    const tool = new OAuthFetchTool(make_store(), make_flow());
    const r = await tool.execute({ action: "fetch", service_id: "nonexistent", url: "https://api.github.com/user" });
    expect(r).toContain("not found");
  });

  it("integration disabled → Error: disabled", async () => {
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: false }) });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = await tool.execute({ action: "fetch", service_id: "gh", url: "https://api.github.com/user" });
    expect(r).toContain("disabled");
  });

  it("token 없음 → Error: no valid access token", async () => {
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true }) });
    const flow = make_flow({ get_valid_access_token: vi.fn().mockResolvedValue({ token: null, error: "not_configured" }) });
    const tool = new OAuthFetchTool(store, flow);
    const r = await tool.execute({ action: "fetch", service_id: "gh", url: "https://api.github.com/user" });
    expect(r).toContain("no valid access token");
  });

  it("fetch 성공 → JSON 결과", async () => {
    fetch_mock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue("application/json") },
      text: async () => JSON.stringify({ login: "octocat" }),
    });
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true, service_type: "github" }) });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = JSON.parse(await tool.execute({ action: "fetch", service_id: "gh", url: "https://api.github.com/user" }));
    expect(r.status).toBe(200);
  });

  it("fetch throw → Error 반환", async () => {
    fetch_mock.mockRejectedValueOnce(new Error("Network error"));
    const store = make_store({ get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true }) });
    const tool = new OAuthFetchTool(store, make_flow());
    const r = await tool.execute({ action: "fetch", service_id: "gh", url: "https://api.github.com/user" });
    expect(r).toContain("Error");
  });

  it("401 응답 → refresh_token 호출 후 재시도", async () => {
    const new_token = "new-access-token";
    // 첫 번째: 401, 두 번째: 200
    fetch_mock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: vi.fn().mockReturnValue(null) },
        text: async () => "Unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: vi.fn().mockReturnValue("application/json") },
        text: async () => JSON.stringify({ login: "octocat" }),
      });

    const store = make_store({
      get: vi.fn().mockReturnValue({ instance_id: "gh", enabled: true, service_type: "github" }),
      get_access_token: vi.fn().mockResolvedValue(new_token),
    });
    const flow = make_flow({ refresh_token: vi.fn().mockResolvedValue({ ok: true }) });
    const tool = new OAuthFetchTool(store, flow);
    const r = JSON.parse(await tool.execute({ action: "fetch", service_id: "gh", url: "https://api.github.com/user" }));
    expect(r.status).toBe(200);
    expect(flow.refresh_token).toHaveBeenCalledWith("gh");
  });

  it("unsupported action → Error", async () => {
    const tool = new OAuthFetchTool(make_store(), make_flow());
    const r = await tool.execute({ action: "unknown" });
    expect(r).toContain("Error");
  });
});
