/**
 * JwtTool / FeatureFlagTool / ActiveRunController — 미커버 경로 보충.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JwtTool } from "@src/agent/tools/jwt.js";
import { FeatureFlagTool } from "@src/agent/tools/feature-flag.js";
import { ActiveRunController } from "@src/channels/active-run-controller.js";
import type { ActiveRun } from "@src/channels/active-run-controller.js";

// ══════════════════════════════════════════
// JwtTool
// ══════════════════════════════════════════

const jwt_tool = new JwtTool();
async function jwt(params: Record<string, unknown>): Promise<unknown> {
  const r = await jwt_tool.execute(params, {} as any);
  try { return JSON.parse(r); } catch { return r; }
}

describe("JwtTool — create", () => {
  it("secret 없음 → 에러", async () => {
    const r = await jwt({ action: "create", payload: "{}" });
    expect(r).toContain("Error");
    expect(r).toContain("secret");
  });

  it("지원 안 하는 알고리즘 → 에러", async () => {
    const r = await jwt({ action: "create", secret: "key", algorithm: "RS256", payload: "{}" });
    expect(r).toContain("Error");
    expect(r).toContain("RS256");
  });

  it("잘못된 JSON payload → 에러", async () => {
    const r = await jwt({ action: "create", secret: "key", payload: "not-json{" });
    expect(r).toContain("Error");
    expect(r).toContain("JSON");
  });

  it("expires_in 잘못된 형식 → 에러", async () => {
    const r = await jwt({ action: "create", secret: "mykey", payload: "{}", expires_in: "abc" });
    expect(r).toContain("Error");
    expect(r).toContain("expires_in");
  });

  it("expires_in '1h' → payload.exp 설정됨", async () => {
    const r = await jwt({ action: "create", secret: "mykey", payload: '{"sub":"u1"}', expires_in: "1h" }) as any;
    expect(r.token).toBeDefined();
    expect(r.payload.exp).toBeGreaterThan(r.payload.iat);
    expect(r.payload.exp - r.payload.iat).toBe(3600);
  });

  it("expires_in '30m' → 1800초 후 만료", async () => {
    const r = await jwt({ action: "create", secret: "mykey", payload: "{}", expires_in: "30m" }) as any;
    expect(r.payload.exp - r.payload.iat).toBe(1800);
  });

  it("expires_in '7d' → 7*86400초 후 만료", async () => {
    const r = await jwt({ action: "create", secret: "mykey", payload: "{}", expires_in: "7d" }) as any;
    expect(r.payload.exp - r.payload.iat).toBe(7 * 86400);
  });

  it("expires_in '60s' → 60초 후 만료", async () => {
    const r = await jwt({ action: "create", secret: "mykey", payload: "{}", expires_in: "60s" }) as any;
    expect(r.payload.exp - r.payload.iat).toBe(60);
  });

  it("expires_in 없음 → exp 필드 없음", async () => {
    const r = await jwt({ action: "create", secret: "mykey", payload: "{}" }) as any;
    expect(r.payload.exp).toBeUndefined();
  });

  it("HS384 알고리즘 → 토큰 생성", async () => {
    const r = await jwt({ action: "create", secret: "mykey", algorithm: "HS384", payload: "{}" }) as any;
    expect(r.token).toBeDefined();
  });

  it("HS512 알고리즘 → 토큰 생성", async () => {
    const r = await jwt({ action: "create", secret: "mykey", algorithm: "HS512", payload: "{}" }) as any;
    expect(r.token).toBeDefined();
  });
});

describe("JwtTool — verify", () => {
  it("token/secret 없음 → 에러", async () => {
    const r = await jwt({ action: "verify", token: "", secret: "key" });
    expect(r).toContain("Error");
  });

  it("잘못된 형식(파트 수 != 3) → 에러", async () => {
    const r = await jwt({ action: "verify", token: "a.b", secret: "key" });
    expect(r).toContain("Error");
    expect(r).toContain("format");
  });

  it("지원 안 하는 알고리즘 헤더 → 에러", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from("{}").toString("base64url");
    const r = await jwt({ action: "verify", token: `${header}.${payload}.fakesig`, secret: "key" });
    expect(r).toContain("Error");
    expect(r).toContain("RS256");
  });

  it("올바른 토큰 verify → valid=true", async () => {
    const created = await jwt({ action: "create", secret: "secret123", payload: '{"user":"alice"}' }) as any;
    const r = await jwt({ action: "verify", token: created.token, secret: "secret123" }) as any;
    expect(r.valid).toBe(true);
    expect(r.sig_valid).toBe(true);
    expect(r.expired).toBe(false);
  });

  it("잘못된 secret → valid=false", async () => {
    const created = await jwt({ action: "create", secret: "secret123", payload: "{}" }) as any;
    const r = await jwt({ action: "verify", token: created.token, secret: "wrong-secret" }) as any;
    expect(r.valid).toBe(false);
    expect(r.sig_valid).toBe(false);
  });

  it("만료된 토큰 → expired=true, valid=false", async () => {
    // 과거 exp로 직접 페이로드 생성
    const now = Math.floor(Date.now() / 1000);
    const payload_obj = { sub: "u1", iat: now - 7200, exp: now - 3600 };
    const created = await jwt({ action: "create", secret: "key", payload: JSON.stringify(payload_obj) }) as any;
    // created.token의 payload는 iat가 now로 덮어씌워짐, 수동으로 만료 토큰 생성
    // 직접 생성: header + payload(exp=과거) + sig
    const { createHmac } = await import("node:crypto");
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "u1", iat: now - 7200, exp: now - 3600 })).toString("base64url");
    const sig = createHmac("sha256", "key").update(`${header}.${body}`).digest("base64url");
    const expired_token = `${header}.${body}.${sig}`;
    const r = await jwt({ action: "verify", token: expired_token, secret: "key" }) as any;
    expect(r.expired).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("malformed 헤더 → 에러", async () => {
    const r = await jwt({ action: "verify", token: "!.!.!", secret: "key" });
    expect(r).toContain("Error");
  });
});

describe("JwtTool — decode", () => {
  it("올바른 토큰 decode", async () => {
    const created = await jwt({ action: "create", secret: "key", payload: '{"role":"admin"}' }) as any;
    const r = await jwt({ action: "decode", token: created.token }) as any;
    expect(r.header.alg).toBe("HS256");
    expect(r.payload.role).toBe("admin");
  });

  it("파트 수 != 3 → 에러", async () => {
    const r = await jwt({ action: "decode", token: "abc" });
    expect(r).toContain("Error");
    expect(r).toContain("format");
  });

  it("malformed payload → 에러", async () => {
    const r = await jwt({ action: "decode", token: "!.!.sig" });
    expect(r).toContain("Error");
  });
});

describe("JwtTool — unknown action", () => {
  it("알 수 없는 action → 에러", async () => {
    const r = await jwt({ action: "foobar" });
    expect(r).toContain("unsupported action");
  });
});

// ══════════════════════════════════════════
// FeatureFlagTool
// ══════════════════════════════════════════

const ff_tool = new FeatureFlagTool();
async function ff(params: Record<string, unknown>): Promise<any> {
  const r = await ff_tool.execute(params, {} as any);
  try { return JSON.parse(r); } catch { return r; }
}

// 고유 플래그 이름 생성 (전역 Map 오염 방지)
let ff_counter = 0;
function ff_name(): string { return `test-flag-${++ff_counter}`; }

describe("FeatureFlagTool — define", () => {
  it("name 없음 → error", async () => {
    const r = await ff({ action: "define" });
    expect(r.error).toBeDefined();
  });

  it("정상 define → enabled/rollout_pct/segments 반환", async () => {
    const r = await ff({ action: "define", name: ff_name(), enabled: true, rollout_pct: 50 });
    expect(r.rollout_pct).toBe(50);
    expect(r.enabled).toBe(true);
  });

  it("segments JSON 파싱 → segments 배열", async () => {
    const r = await ff({ action: "define", name: ff_name(), segments: '["beta","internal"]' });
    expect(r.segments).toEqual(["beta", "internal"]);
  });

  it("segments 잘못된 JSON → 빈 배열", async () => {
    const r = await ff({ action: "define", name: ff_name(), segments: "{invalid" });
    expect(r.segments).toEqual([]);
  });
});

describe("FeatureFlagTool — evaluate", () => {
  it("flag 없음 → error", async () => {
    const r = await ff({ action: "evaluate", name: "nonexistent-flag-xyz" });
    expect(r.error).toBeDefined();
  });

  it("override=false → reason=override, result=false", async () => {
    const name = ff_name();
    await ff({ action: "define", name });
    await ff({ action: "override", name, user_id: "alice", value: false });
    const r = await ff({ action: "evaluate", name, user_id: "alice" });
    expect(r.reason).toBe("override");
    expect(r.result).toBe(false);
  });

  it("override=true → reason=override, result=true, true_count 증가", async () => {
    const name = ff_name();
    await ff({ action: "define", name });
    await ff({ action: "override", name, user_id: "bob", value: true });
    const r = await ff({ action: "evaluate", name, user_id: "bob" });
    expect(r.reason).toBe("override");
    expect(r.result).toBe(true);
    const stats = await ff({ action: "stats", name });
    expect(stats.true_count).toBe(1);
  });

  it("enabled=false → reason=disabled", async () => {
    const name = ff_name();
    await ff({ action: "define", name, enabled: false });
    const r = await ff({ action: "evaluate", name, user_id: "charlie" });
    expect(r.reason).toBe("disabled");
    expect(r.result).toBe(false);
  });

  it("segment 불일치 → reason=segment_mismatch", async () => {
    const name = ff_name();
    await ff({ action: "define", name, segments: '["premium"]' });
    const r = await ff({ action: "evaluate", name, user_id: "dave", user_segments: '["basic"]' });
    expect(r.reason).toBe("segment_mismatch");
    expect(r.result).toBe(false);
  });

  it("segment 일치 → rollout 평가", async () => {
    const name = ff_name();
    await ff({ action: "define", name, rollout_pct: 100, segments: '["beta"]' });
    const r = await ff({ action: "evaluate", name, user_id: "eve", user_segments: '["beta"]' });
    expect(r.result).toBe(true);
    expect(r.reason).toBe("rollout");
  });

  it("rollout_pct=0 → result=false", async () => {
    const name = ff_name();
    await ff({ action: "define", name, rollout_pct: 0 });
    const r = await ff({ action: "evaluate", name, user_id: "frank" });
    expect(r.result).toBe(false);
    expect(r.reason).toBe("rollout");
  });

  it("rollout_pct=100 → result=true + true_count 증가", async () => {
    const name = ff_name();
    await ff({ action: "define", name, rollout_pct: 100 });
    const r = await ff({ action: "evaluate", name, user_id: "grace" });
    expect(r.result).toBe(true);
    expect(r.reason).toBe("rollout");
  });

  it("user_segments 잘못된 JSON → 빈 배열로 처리", async () => {
    const name = ff_name();
    await ff({ action: "define", name, segments: '["beta"]' });
    const r = await ff({ action: "evaluate", name, user_id: "henry", user_segments: "{invalid" });
    expect(r.reason).toBe("segment_mismatch");
  });
});

describe("FeatureFlagTool — rollout / user_segment / override / list / stats", () => {
  it("rollout: flag 없음 → error", async () => {
    const r = await ff({ action: "rollout", name: "no-such-flag" });
    expect(r.error).toBeDefined();
  });

  it("rollout: pct 변경", async () => {
    const name = ff_name();
    await ff({ action: "define", name, rollout_pct: 30 });
    const r = await ff({ action: "rollout", name, rollout_pct: 70 });
    expect(r.rollout_pct).toBe(70);
  });

  it("user_segment: flag 없음 → error", async () => {
    const r = await ff({ action: "user_segment", name: "no-such-flag-seg" });
    expect(r.error).toBeDefined();
  });

  it("user_segment: segments 업데이트", async () => {
    const name = ff_name();
    await ff({ action: "define", name });
    const r = await ff({ action: "user_segment", name, segments: '["vip"]' });
    expect(r.segments).toContain("vip");
  });

  it("user_segment: 잘못된 segments JSON → 빈 배열", async () => {
    const name = ff_name();
    await ff({ action: "define", name });
    const r = await ff({ action: "user_segment", name, segments: "not-json" });
    expect(r.segments).toEqual([]);
  });

  it("override: flag 없음 → error", async () => {
    const r = await ff({ action: "override", name: "no-such-flag-ov", user_id: "x" });
    expect(r.error).toBeDefined();
  });

  it("override: user_id 없음 → error", async () => {
    const name = ff_name();
    await ff({ action: "define", name });
    const r = await ff({ action: "override", name });
    expect(r.error).toBeDefined();
  });

  it("list → 플래그 목록 반환", async () => {
    const r = await ff({ action: "list" });
    expect(Array.isArray(r.flags)).toBe(true);
    expect(typeof r.count).toBe("number");
  });

  it("stats: flag 없음 → error", async () => {
    const r = await ff({ action: "stats", name: "nonexistent-stats" });
    expect(r.error).toBeDefined();
  });

  it("stats: eval_count=0 → true_rate=0", async () => {
    const name = ff_name();
    await ff({ action: "define", name });
    const r = await ff({ action: "stats", name });
    expect(r.eval_count).toBe(0);
    expect(r.true_rate).toBe(0);
  });

  it("stats: 누적 통계 반환", async () => {
    const name = ff_name();
    await ff({ action: "define", name, rollout_pct: 100 });
    await ff({ action: "evaluate", name, user_id: "u1" });
    await ff({ action: "evaluate", name, user_id: "u2" });
    const r = await ff({ action: "stats", name });
    expect(r.eval_count).toBe(2);
    expect(r.true_count).toBe(2);
    expect(r.true_rate).toBeGreaterThan(0);
  });

  it("unknown action → error", async () => {
    const r = await ff({ action: "noop" });
    expect(r.error).toContain("noop");
  });
});

// ══════════════════════════════════════════
// ActiveRunController
// ══════════════════════════════════════════

function make_run(chat_id = "chat1", aborted = false, has_send_input = true): ActiveRun {
  const abort = new AbortController();
  if (aborted) abort.abort();
  return {
    abort,
    provider: "slack" as any,
    chat_id,
    alias: "default",
    done: Promise.resolve(),
    send_input: has_send_input ? vi.fn() : undefined,
  };
}

describe("ActiveRunController — 기본 동작", () => {
  it("register → get으로 조회", () => {
    const ctrl = new ActiveRunController();
    const run = make_run();
    ctrl.register("key1", run);
    expect(ctrl.get("key1")).toBe(run);
    expect(ctrl.size).toBe(1);
  });

  it("unregister: abort 일치 → 삭제", () => {
    const ctrl = new ActiveRunController();
    const run = make_run();
    ctrl.register("key1", run);
    ctrl.unregister("key1", run.abort);
    expect(ctrl.get("key1")).toBeUndefined();
    expect(ctrl.size).toBe(0);
  });

  it("unregister: abort 불일치 → 유지", () => {
    const ctrl = new ActiveRunController();
    const run = make_run();
    ctrl.register("key1", run);
    ctrl.unregister("key1", new AbortController());
    expect(ctrl.size).toBe(1);
  });

  it("clear → 전체 삭제", () => {
    const ctrl = new ActiveRunController();
    ctrl.register("a", make_run());
    ctrl.register("b", make_run());
    ctrl.clear();
    expect(ctrl.size).toBe(0);
  });
});

describe("ActiveRunController — cancel", () => {
  it("key 없음(전체 취소) → 모두 abort + 개수 반환", () => {
    const ctrl = new ActiveRunController();
    const r1 = make_run();
    const r2 = make_run();
    ctrl.register("a:1", r1);
    ctrl.register("b:1", r2);
    const count = ctrl.cancel();
    expect(count).toBe(2);
    expect(r1.abort.signal.aborted).toBe(true);
    expect(r2.abort.signal.aborted).toBe(true);
    expect(ctrl.size).toBe(0);
  });

  it("key 지정(prefix 매칭) → 해당 런만 취소", () => {
    const ctrl = new ActiveRunController();
    const r1 = make_run();
    const r2 = make_run();
    ctrl.register("slack:chat1", r1);
    ctrl.register("telegram:chat2", r2);
    const count = ctrl.cancel("slack");
    expect(count).toBe(1);
    expect(r1.abort.signal.aborted).toBe(true);
    expect(r2.abort.signal.aborted).toBe(false);
  });

  it("cancel with tracker → tracker.end() 호출", () => {
    const ctrl = new ActiveRunController();
    const tracker = {
      find_active_by_key: vi.fn().mockReturnValue({ run_id: "run-123" }),
      end: vi.fn(),
    };
    ctrl.set_tracker(tracker);
    const run = make_run();
    ctrl.register("slack:chat1", run);
    ctrl.cancel("slack:chat1");
    expect(tracker.find_active_by_key).toHaveBeenCalled();
    expect(tracker.end).toHaveBeenCalledWith("run-123", "cancelled", "stopped_by_request");
  });

  it("cancel with tracker → find_active_by_key null → end 미호출", () => {
    const ctrl = new ActiveRunController();
    const tracker = {
      find_active_by_key: vi.fn().mockReturnValue(null),
      end: vi.fn(),
    };
    ctrl.set_tracker(tracker);
    ctrl.register("slack:chat1", make_run());
    ctrl.cancel("slack:chat1");
    expect(tracker.end).not.toHaveBeenCalled();
  });
});

describe("ActiveRunController — find_by_chat_id", () => {
  it("send_input 없음 → undefined", () => {
    const ctrl = new ActiveRunController();
    ctrl.register("key1", make_run("chat1", false, false));
    expect(ctrl.find_by_chat_id("chat1")).toBeUndefined();
  });

  it("aborted → undefined", () => {
    const ctrl = new ActiveRunController();
    ctrl.register("key1", make_run("chat1", true, true));
    expect(ctrl.find_by_chat_id("chat1")).toBeUndefined();
  });

  it("send_input 있고 미취소 → 반환", () => {
    const ctrl = new ActiveRunController();
    const run = make_run("chat1", false, true);
    ctrl.register("key1", run);
    expect(ctrl.find_by_chat_id("chat1")).toBe(run);
  });

  it("chat_id 불일치 → undefined", () => {
    const ctrl = new ActiveRunController();
    ctrl.register("key1", make_run("chat1"));
    expect(ctrl.find_by_chat_id("chat-other")).toBeUndefined();
  });
});
