/**
 * ToneHandler + ModelHandler 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToneHandler } from "@src/channels/commands/tone.handler.js";
import { ModelHandler, type ModelAccess } from "@src/channels/commands/model.handler.js";
import { TonePreferenceStore } from "@src/channels/persona-message-renderer.js";
import { format_mention } from "@src/channels/commands/types.js";
import type { CommandContext } from "@src/channels/commands/types.js";

// ── 헬퍼: CommandContext 생성 ──

function make_ctx(
  command_name: string,
  args: string[],
  provider = "slack",
  sender_id = "U123",
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider,
    message: {
      id: "msg-1",
      provider,
      channel: provider,
      sender_id,
      chat_id: "C001",
      content: `/${command_name} ${args.join(" ")}`,
      at: new Date().toISOString(),
    },
    command: {
      raw: `/${command_name} ${args.join(" ")}`,
      name: command_name,
      args,
      args_lower: args.map((a) => a.toLowerCase()),
    },
    text: args.join(" "),
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

// ── ToneHandler 테스트 ──

describe("ToneHandler — can_handle", () => {
  it("'tone' 커맨드 → true", () => {
    const store = new TonePreferenceStore("/dev/null");
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", []);
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("'톤' 별칭 → true", () => {
    const store = new TonePreferenceStore("/dev/null");
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("톤", []);
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("'help' 커맨드 → false", () => {
    const store = new TonePreferenceStore("/dev/null");
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("help", []);
    expect(h.can_handle(ctx)).toBe(false);
  });

  it("name 프로퍼티 = 'tone'", () => {
    const store = new TonePreferenceStore("/dev/null");
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    expect(h.name).toBe("tone");
  });
});

describe("ToneHandler — handle: 상태 조회", () => {
  let ws: string;
  let store: TonePreferenceStore;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "tone-store-"));
    store = new TonePreferenceStore(join(ws, "tone.json"));
  });

  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("args 없음 → '설정된 톤 선호가 없습니다' 반환", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", []);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("설정된 톤 선호가 없습니다");
  });

  it("status 서브커맨드 → 상태 표시", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["status"]);
    await h.handle(ctx);
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("상태 서브커맨드 → 상태 표시", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["상태"]);
    await h.handle(ctx);
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("설정 후 status → 설정값 포함", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const set_ctx = make_ctx("tone", ["casual"]);
    await h.handle(set_ctx);
    const status_ctx = make_ctx("tone", ["status"]);
    await h.handle(status_ctx);
    expect(status_ctx.replies[0]).toContain("casual");
  });
});

describe("ToneHandler — handle: reset", () => {
  let ws: string;
  let store: TonePreferenceStore;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "tone-reset-"));
    store = new TonePreferenceStore(join(ws, "tone.json"));
  });

  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("reset → '초기화되었습니다' 반환", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["reset"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("초기화");
  });

  it("초기화 서브커맨드 → 초기화 완료", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["초기화"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("초기화");
  });
});

describe("ToneHandler — handle: concepts 목록", () => {
  it("concepts → '등록된 컨셉 팩' 반환", async () => {
    const store = new TonePreferenceStore("/dev/null");
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["concepts"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("컨셉 팩");
  });

  it("컨셉 별칭 → 컨셉 팩 목록", async () => {
    const store = new TonePreferenceStore("/dev/null");
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["컨셉"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("컨셉 팩");
  });
});

describe("ToneHandler — handle: tone 설정", () => {
  let ws: string;
  let store: TonePreferenceStore;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "tone-set-"));
    store = new TonePreferenceStore(join(ws, "tone.json"));
  });

  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("casual → politeness 설정", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["casual"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("저장되었습니다");
    expect(store.get("C001").politeness).toBe("casual");
  });

  it("반말 → politeness=casual", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["반말"]);
    await h.handle(ctx);
    expect(store.get("C001").politeness).toBe("casual");
  });

  it("warm → warmth 설정", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["warm"]);
    await h.handle(ctx);
    expect(store.get("C001").warmth).toBe("warm");
  });

  it("short → brevity 설정", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["short"]);
    await h.handle(ctx);
    expect(store.get("C001").brevity).toBe("short");
  });

  it("복합 설정 (casual warm short)", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["casual", "warm", "short"]);
    await h.handle(ctx);
    const pref = store.get("C001");
    expect(pref.politeness).toBe("casual");
    expect(pref.warmth).toBe("warm");
    expect(pref.brevity).toBe("short");
  });

  it("알 수 없는 토큰 → 오류 메시지", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["unknown_xyz_token"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("인식할 수 없는");
  });

  it("telegram provider → 멘션 없음", async () => {
    const h = new ToneHandler(store, (ctx) => ctx.message.chat_id);
    const ctx = make_ctx("tone", ["casual"], "telegram", "user1");
    await h.handle(ctx);
    expect(ctx.replies[0]).not.toContain("@user1");
  });
});

// ── ModelHandler 테스트 ──

function make_model_access(models: string[], default_model: string | null = null): ModelAccess {
  let current = default_model;
  const model_set = new Set(models);
  return {
    list: () => models.map((name) => ({ name })),
    get_default: () => current,
    set_default: (m: string) => {
      if (!model_set.has(m)) return false;
      current = m;
      return true;
    },
  };
}

describe("ModelHandler — can_handle", () => {
  it("'model' 커맨드 → true", () => {
    const h = new ModelHandler(make_model_access([]));
    const ctx = make_ctx("model", []);
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("'models' 별칭 → true", () => {
    const h = new ModelHandler(make_model_access([]));
    const ctx = make_ctx("models", []);
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("'모델' 별칭 → true", () => {
    const h = new ModelHandler(make_model_access([]));
    const ctx = make_ctx("모델", []);
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("다른 커맨드 → false", () => {
    const h = new ModelHandler(make_model_access([]));
    const ctx = make_ctx("status", []);
    expect(h.can_handle(ctx)).toBe(false);
  });

  it("name 프로퍼티 = 'model'", () => {
    const h = new ModelHandler(make_model_access([]));
    expect(h.name).toBe("model");
  });
});

describe("ModelHandler — handle: 목록 표시", () => {
  // action이 비어 있으면 format_subcommand_guide("model")가 먼저 동작하므로
  // 목록 표시를 테스트하려면 "list" 같은 알 수 없는 액션(set 아님)을 사용한다.
  it("모델 목록 표시 (list 액션)", async () => {
    const h = new ModelHandler(make_model_access(["gpt-4", "claude-3"], "gpt-4"));
    const ctx = make_ctx("model", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("gpt-4");
    expect(ctx.replies[0]).toContain("claude-3");
    expect(ctx.replies[0]).toContain("← current");
  });

  it("모델 없음 → '등록된 모델이 없습니다'", async () => {
    const h = new ModelHandler(make_model_access([]));
    const ctx = make_ctx("model", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("등록된 모델이 없습니다");
  });

  it("default 없이 목록 표시", async () => {
    const h = new ModelHandler(make_model_access(["m1", "m2"]));
    const ctx = make_ctx("model", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("m1");
    expect(ctx.replies[0]).not.toContain("← current");
  });

  it("args 없으면 subcommand guide 표시", async () => {
    const h = new ModelHandler(make_model_access(["claude-3"]));
    const ctx = make_ctx("model", []);
    await h.handle(ctx);
    // guide가 없으면 모델 목록, 있으면 guide
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});

describe("ModelHandler — handle: set 서브커맨드", () => {
  it("set <model> → 모델 변경 성공", async () => {
    const h = new ModelHandler(make_model_access(["claude-3", "gpt-4"]));
    const ctx = make_ctx("model", ["set", "claude-3"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("✅");
    expect(ctx.replies[0]).toContain("claude-3");
  });

  it("set <없는 모델> → ❌ 메시지", async () => {
    const h = new ModelHandler(make_model_access(["claude-3"]));
    const ctx = make_ctx("model", ["set", "gpt-99"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("❌");
  });

  it("set 인수 없음 → 사용법 안내", async () => {
    const h = new ModelHandler(make_model_access(["claude-3"]));
    const ctx = make_ctx("model", ["set"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("사용법");
  });

  it("설정 서브커맨드(한국어) → 모델 변경", async () => {
    const h = new ModelHandler(make_model_access(["claude-3"]));
    const ctx = make_ctx("model", ["설정", "claude-3"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("✅");
  });
});

// ── format_mention 테스트 ──

describe("format_mention", () => {
  it("slack → '@sender_id '", () => {
    expect(format_mention("slack", "U123")).toBe("@U123 ");
  });

  it("telegram → 빈 문자열", () => {
    expect(format_mention("telegram", "user1")).toBe("");
  });

  it("web → 빈 문자열", () => {
    expect(format_mention("web", "user1")).toBe("");
  });

  it("discord → '@sender_id '", () => {
    expect(format_mention("discord", "D456")).toBe("@D456 ");
  });
});

// ── TonePreferenceStore 직접 테스트 ──

describe("TonePreferenceStore", () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "tone-pref-"));
  });

  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("get: 없는 키 → 빈 객체", () => {
    const s = new TonePreferenceStore(join(ws, "t.json"));
    expect(s.get("no-key")).toEqual({});
  });

  it("set → get으로 확인", () => {
    const s = new TonePreferenceStore(join(ws, "t.json"));
    s.set("room-1", { politeness: "casual" });
    expect(s.get("room-1").politeness).toBe("casual");
  });

  it("set 여러 번 → 누적 merge", () => {
    const s = new TonePreferenceStore(join(ws, "t.json"));
    s.set("room-1", { politeness: "casual" });
    s.set("room-1", { warmth: "warm" });
    const pref = s.get("room-1");
    expect(pref.politeness).toBe("casual");
    expect(pref.warmth).toBe("warm");
  });

  it("clear → 빈 객체", () => {
    const s = new TonePreferenceStore(join(ws, "t.json"));
    s.set("room-1", { politeness: "casual" });
    s.clear("room-1");
    expect(s.get("room-1")).toEqual({});
  });

  it("파일 지속성: 새 인스턴스에서 로드", () => {
    const path = join(ws, "persist.json");
    const s1 = new TonePreferenceStore(path);
    s1.set("room-x", { brevity: "short" });
    const s2 = new TonePreferenceStore(path);
    expect(s2.get("room-x").brevity).toBe("short");
  });

  it("손상된 파일 → 빈 상태로 시작", () => {
    const path = join(ws, "corrupt.json");
    require("node:fs").writeFileSync(path, "not-json");
    const s = new TonePreferenceStore(path);
    expect(s.get("any")).toEqual({});
  });
});

import { beforeEach, afterEach } from "vitest";
