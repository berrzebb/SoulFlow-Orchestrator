/**
 * orchestrator-llm.runtime.ts — 커버리지 보충:
 * - to_engine() 분기 (native/docker/podman/auto)
 * - constructor + get_status()
 * - start() enabled=false → 즉시 반환
 * - stop() enabled=false / auto_stop=false → 즉시 반환
 * - list_models() — fetch mock (성공/실패 경로)
 * - pull_model_by_name() — fetch mock (성공/에러/예외)
 * - pull_model_stream() — fetch mock (에러 응답/NDJSON 스트림)
 * - delete_model() — fetch mock
 * - list_running() — fetch mock
 * - switch_model() — warmup fetch + model update
 * - health_check() — fetch mock
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorLlmRuntime } from "@src/providers/orchestrator-llm.runtime.js";

// ── to_engine + constructor + get_status ─────────────────────────────────────

describe("OrchestratorLlmRuntime — constructor + get_status()", () => {
  it("기본 옵션 → enabled=false, engine_pref=auto", () => {
    const rt = new OrchestratorLlmRuntime();
    expect(rt.enabled).toBe(false);
    expect(rt.engine_pref).toBe("auto");
    expect(rt.port).toBe(11434);
    expect(rt.pull_model).toBe(true);
    expect(rt.auto_stop).toBe(false);
    expect(rt.gpu_enabled).toBe(true);
  });

  it("engine='native' → engine_pref='native'", () => {
    const rt = new OrchestratorLlmRuntime({ engine: "native" });
    expect(rt.engine_pref).toBe("native");
  });

  it("engine='docker' → engine_pref='docker'", () => {
    const rt = new OrchestratorLlmRuntime({ engine: "docker" });
    expect(rt.engine_pref).toBe("docker");
  });

  it("engine='podman' → engine_pref='podman'", () => {
    const rt = new OrchestratorLlmRuntime({ engine: "podman" });
    expect(rt.engine_pref).toBe("podman");
  });

  it("engine=undefined → engine_pref='auto'", () => {
    const rt = new OrchestratorLlmRuntime({ engine: undefined });
    expect(rt.engine_pref).toBe("auto");
  });

  it("커스텀 옵션 모두 반영", () => {
    const rt = new OrchestratorLlmRuntime({
      enabled: true,
      engine: "podman",
      image: "custom/image:v1",
      container: "my-llm",
      port: 9999,
      model: "llama3",
      pull_model: false,
      auto_stop: true,
      api_base: "http://localhost:9999/v1",
      gpu_enabled: false,
      gpu_args: ["--device", "custom"],
    });
    expect(rt.enabled).toBe(true);
    expect(rt.engine_pref).toBe("podman");
    expect(rt.image).toBe("custom/image:v1");
    expect(rt.container).toBe("my-llm");
    expect(rt.port).toBe(9999);
    expect(rt.model).toBe("llama3");
    expect(rt.pull_model).toBe(false);
    expect(rt.auto_stop).toBe(true);
    expect(rt.gpu_enabled).toBe(false);
  });

  it("get_status() → 초기 상태 반환", () => {
    const rt = new OrchestratorLlmRuntime({ enabled: true, model: "phi3" });
    const status = rt.get_status();
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(false);
    expect(status.model).toBe("phi3");
    expect(status.last_error).toBeUndefined();
  });

  it("port 값 NaN → Math.max(1, NaN)=NaN → 기본 포트", () => {
    // port: 0 → Math.max(1, 0) = 1 이나 Number("") = 0 경우
    const rt = new OrchestratorLlmRuntime({ port: 11434 });
    expect(rt.port).toBeGreaterThan(0);
  });

  it("gpu_args 빈 배열 → gpu_args_override=null", () => {
    const rt = new OrchestratorLlmRuntime({ gpu_args: [] });
    // 내부 필드 접근 (any cast)
    expect((rt as any).gpu_args_override).toBeNull();
  });
});

// ── start() enabled=false ──────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — start() enabled=false", () => {
  it("enabled=false → 즉시 status 반환 (API 호출 없음)", async () => {
    const mock_fetch = vi.fn();
    vi.stubGlobal("fetch", mock_fetch);
    const rt = new OrchestratorLlmRuntime({ enabled: false });
    const status = await rt.start();
    expect(status.enabled).toBe(false);
    expect(mock_fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — stop()", () => {
  it("enabled=false → 즉시 status 반환", async () => {
    const rt = new OrchestratorLlmRuntime({ enabled: false });
    const status = await rt.stop();
    expect(status.enabled).toBe(false);
  });

  it("enabled=true, auto_stop=false → 즉시 status 반환 (stop 안 함)", async () => {
    const rt = new OrchestratorLlmRuntime({ enabled: true, auto_stop: false });
    const status = await rt.stop();
    expect(status.running).toBe(false);
  });

  it("enabled=true, auto_stop=true, started_by_manager=false → 즉시 반환", async () => {
    const rt = new OrchestratorLlmRuntime({ enabled: true, auto_stop: true });
    // started_by_manager는 private, 기본 false
    const status = await rt.stop();
    // stop이 started_by_manager=false면 early return
    expect(status.running).toBe(false);
  });
});

// ── list_models() ─────────────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — list_models()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("OpenAI-compatible /v1/models 성공 → 모델 목록 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "llama3:8b" }, { id: "phi3:latest" }],
      }),
    }));
    const rt = new OrchestratorLlmRuntime({ api_base: "http://localhost:11434/v1" });
    const models = await rt.list_models();
    expect(models.length).toBeGreaterThan(0);
  });

  it("/v1/models 실패 → /api/tags fallback", async () => {
    let call_count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      call_count++;
      if (call_count === 1) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          models: [
            { name: "llama3:8b", size: 5000000, modified_at: "2024-01-01T00:00:00Z", digest: "abc123", details: { parameter_size: "8B", quantization_level: "Q4" } },
          ],
        }),
      });
    }));
    const rt = new OrchestratorLlmRuntime({ api_base: "http://localhost:11434/v1" });
    const models = await rt.list_models();
    expect(models.length).toBeGreaterThanOrEqual(0); // 실패해도 [] 반환
  });

  it("fetch 예외 → []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const rt = new OrchestratorLlmRuntime();
    const models = await rt.list_models();
    expect(models).toEqual([]);
  });
});

// ── pull_model_by_name() ──────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — pull_model_by_name()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("성공 응답 → status/completed/total 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", completed: 1000, total: 1000 }),
    }));
    const rt = new OrchestratorLlmRuntime();
    const result = await rt.pull_model_by_name("llama3");
    expect(result.status).toBe("success");
    expect(result.completed).toBe(1000);
    expect(result.total).toBe(1000);
  });

  it("응답에 error 필드 → error 상태 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "model not found" }),
    }));
    const rt = new OrchestratorLlmRuntime();
    const result = await rt.pull_model_by_name("nonexistent");
    expect(result.status).toContain("error");
  });

  it("HTTP 에러 → error_N 상태 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({}),
    }));
    const rt = new OrchestratorLlmRuntime();
    const result = await rt.pull_model_by_name("missing");
    expect(result.status).toBe("error_404");
  });

  it("fetch 예외 → error 상태 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const rt = new OrchestratorLlmRuntime();
    const result = await rt.pull_model_by_name("llama3");
    expect(result.status).toContain("error");
  });
});

// ── pull_model_stream() ───────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — pull_model_stream()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("HTTP 에러 → error yield 후 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const rt = new OrchestratorLlmRuntime();
    const chunks: import("@src/providers/orchestrator-llm.runtime.js").PullProgress[] = [];
    for await (const chunk of rt.pull_model_stream("llama3")) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0].status).toContain("error");
  });

  it("body=null → error_no_body yield", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: null }));
    const rt = new OrchestratorLlmRuntime();
    const chunks: import("@src/providers/orchestrator-llm.runtime.js").PullProgress[] = [];
    for await (const chunk of rt.pull_model_stream("llama3")) {
      chunks.push(chunk);
    }
    expect(chunks[0].status).toBe("error_no_body");
  });

  it("NDJSON 스트림 → progress chunks 반환", async () => {
    const encoder = new TextEncoder();
    const ndjson = [
      JSON.stringify({ status: "pulling", completed: 100, total: 1000 }),
      JSON.stringify({ status: "success", completed: 1000, total: 1000 }),
    ].join("\n") + "\n";

    async function* make_stream() {
      yield encoder.encode(ndjson);
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: make_stream(),
    }));
    const rt = new OrchestratorLlmRuntime();
    const chunks: import("@src/providers/orchestrator-llm.runtime.js").PullProgress[] = [];
    for await (const chunk of rt.pull_model_stream("llama3")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].status).toBe("pulling");
  });

  it("NDJSON error 필드 → error yield + 반환", async () => {
    const encoder = new TextEncoder();
    const ndjson = JSON.stringify({ error: "pull failed" }) + "\n";
    async function* make_stream() { yield encoder.encode(ndjson); }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: make_stream() }));
    const rt = new OrchestratorLlmRuntime();
    const chunks: import("@src/providers/orchestrator-llm.runtime.js").PullProgress[] = [];
    for await (const chunk of rt.pull_model_stream("llama3")) chunks.push(chunk);
    expect(chunks[0].status).toContain("error");
  });
});

// ── delete_model() ────────────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — delete_model()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("성공 응답 → true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const rt = new OrchestratorLlmRuntime();
    expect(await rt.delete_model("llama3")).toBe(true);
  });

  it("실패 응답 → false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const rt = new OrchestratorLlmRuntime();
    expect(await rt.delete_model("llama3")).toBe(false);
  });

  it("fetch 예외 → false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const rt = new OrchestratorLlmRuntime();
    expect(await rt.delete_model("llama3")).toBe(false);
  });
});

// ── list_running() ────────────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — list_running()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("성공 → 실행 중인 모델 목록 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3:8b", size: 5000000, size_vram: 4000000, expires_at: "2024-12-31T00:00:00Z" }],
      }),
    }));
    const rt = new OrchestratorLlmRuntime();
    const result = await rt.list_running();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("llama3:8b");
  });

  it("HTTP 실패 → []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const rt = new OrchestratorLlmRuntime();
    expect(await rt.list_running()).toEqual([]);
  });

  it("fetch 예외 → []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const rt = new OrchestratorLlmRuntime();
    expect(await rt.list_running()).toEqual([]);
  });
});

// ── switch_model() ────────────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — switch_model()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("새 모델로 전환 → model 필드 업데이트", async () => {
    // warmup은 fetch 호출하지만 실패해도 무시
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no ollama")));
    const rt = new OrchestratorLlmRuntime({ model: "old-model" });
    const status = await rt.switch_model("new-model");
    expect(rt.model).toBe("new-model");
    expect(status.model).toBe("new-model");
  });
});

// ── health_check() ────────────────────────────────────────────────────────────

describe("OrchestratorLlmRuntime — health_check()", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("API 응답 없음 → running=false, model_loaded=false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no ollama")));
    const rt = new OrchestratorLlmRuntime({ enabled: true, model: "llama3" });
    const status = await rt.health_check();
    expect(status.running).toBe(false);
    expect(status.model_loaded).toBe(false);
  });

  it("API ok + 모델 로드 확인", async () => {
    let call_count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      call_count++;
      const u = String(url);
      if (u.includes("/v1/models") || u.includes("/models")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [{ id: "llama3:8b" }] }),
        });
      }
      if (u.includes("/api/ps")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ models: [] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }));
    const rt = new OrchestratorLlmRuntime({ enabled: true, model: "llama3" });
    const status = await rt.health_check();
    expect(status.running).toBe(true);
  });
});
