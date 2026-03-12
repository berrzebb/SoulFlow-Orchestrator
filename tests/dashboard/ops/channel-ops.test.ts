/**
 * dashboard/ops/channel.ts — 전체 커버리지 (cov):
 * - list(), get(), create(), update(), remove()
 * - test_connection (slack/discord/telegram, HTTP 실패, 에러)
 * - list_providers()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { create_channel_ops } from "@src/dashboard/ops/channel.js";

// ── create_channel_instance mock ──────────────────────────────────────────────
vi.mock("@src/channels/index.js", () => ({
  create_channel_instance: vi.fn(),
}));
import { create_channel_instance } from "@src/channels/index.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function make_config(override: Partial<{
  instance_id: string; provider: string; label: string; enabled: boolean;
  settings: Record<string, unknown>; created_at: string; updated_at: string;
}> = {}) {
  return {
    instance_id: "ch1",
    provider: "slack",
    label: "Slack",
    enabled: true,
    settings: { botToken: "xoxb-test" },
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...override,
  };
}

function make_instance_store(overrides: Partial<{
  list_result: ReturnType<typeof make_config>[];
  get_result: ReturnType<typeof make_config> | null;
  has_token_result: boolean;
  get_token_result: string | null;
  remove_result: boolean;
}> = {}) {
  const {
    list_result = [make_config()],
    get_result = make_config(),
    has_token_result = true,
    get_token_result = "xoxb-token",
    remove_result = true,
  } = overrides;

  return {
    list: vi.fn().mockReturnValue(list_result),
    get: vi.fn().mockReturnValue(get_result),
    has_token: vi.fn().mockResolvedValue(has_token_result),
    get_token: vi.fn().mockResolvedValue(get_token_result),
    set_token: vi.fn().mockResolvedValue(undefined),
    remove_token: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn(),
    update_settings: vi.fn(),
    remove: vi.fn().mockReturnValue(remove_result),
  };
}

function make_registry(overrides: Partial<{
  health: Array<{ instance_id: string; running: boolean; last_error?: string }>;
  channel_mock: { is_running: () => boolean; stop: () => Promise<void> } | null;
}> = {}) {
  const { health = [], channel_mock = null } = overrides;
  return {
    get_health: vi.fn().mockReturnValue(health),
    get_channel: vi.fn().mockReturnValue(channel_mock),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function make_app_config() {
  return {} as any;
}

// ── list() ───────────────────────────────────────────────────────────────────

describe("create_channel_ops — list()", () => {
  it("인스턴스 목록 + health_map 매핑", async () => {
    const instance_store = make_instance_store({
      list_result: [make_config({ instance_id: "ch1" }), make_config({ instance_id: "ch2", provider: "discord" })],
    });
    const channels = make_registry({
      health: [{ instance_id: "ch1", running: true }],
    });
    instance_store.get.mockReturnValue(make_config());

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const list = await ops.list();

    expect(list).toHaveLength(2);
    expect(instance_store.has_token).toHaveBeenCalledTimes(2);
  });

  it("인스턴스 없으면 빈 배열", async () => {
    const instance_store = make_instance_store({ list_result: [] });
    const channels = make_registry();
    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const list = await ops.list();
    expect(list).toHaveLength(0);
  });
});

// ── get() ────────────────────────────────────────────────────────────────────

describe("create_channel_ops — get()", () => {
  it("존재하는 instance_id → ChannelStatusInfo 반환", async () => {
    const instance_store = make_instance_store();
    const channels = make_registry({ health: [{ instance_id: "ch1", running: true }] });
    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.get("ch1");
    expect(result).not.toBeNull();
    expect(result!.instance_id).toBe("ch1");
    expect(result!.running).toBe(true);
  });

  it("존재하지 않는 instance_id → null", async () => {
    const instance_store = make_instance_store({ get_result: null });
    const channels = make_registry();
    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.get("unknown");
    expect(result).toBeNull();
  });

  it("health 없는 instance → running=false", async () => {
    const instance_store = make_instance_store();
    const channels = make_registry({ health: [] });
    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.get("ch1");
    expect(result!.running).toBe(false);
  });
});

// ── create() ─────────────────────────────────────────────────────────────────

describe("create_channel_ops — create()", () => {
  beforeEach(() => {
    vi.mocked(create_channel_instance).mockReset();
  });

  it("필수 필드 없음 → error 반환", async () => {
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: make_instance_store() as any, app_config: make_app_config() });
    const result = await ops.create({} as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("instance_id_and_provider_required");
  });

  it("이미 존재하는 instance_id → error 반환", async () => {
    const instance_store = make_instance_store({ get_result: make_config() });
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.create({ instance_id: "ch1", provider: "slack" } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("instance_already_exists");
  });

  it("유효한 입력 + enabled + channel 시작 성공", async () => {
    const calls: number[] = [];
    let call_count = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      call_count++;
      // 첫 번째 호출(존재 확인): null, 이후(enabled 확인): config
      return call_count === 1 ? null : make_config({ enabled: true });
    });

    const mock_channel = { instance_id: "ch1", start: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(create_channel_instance).mockReturnValue(mock_channel as any);
    const channels = make_registry();

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.create({ instance_id: "ch1", provider: "slack", token: "xoxb", enabled: true } as any);

    expect(result.ok).toBe(true);
    expect(instance_store.upsert).toHaveBeenCalled();
    expect(instance_store.set_token).toHaveBeenCalledWith("ch1", "xoxb");
    expect(channels.register).toHaveBeenCalled();
    expect(mock_channel.start).toHaveBeenCalled();
  });

  it("channel start 실패 → ok:true (에러 무시)", async () => {
    let call_count = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      call_count++;
      return call_count === 1 ? null : make_config({ enabled: true });
    });

    const mock_channel = { instance_id: "ch1", start: vi.fn().mockRejectedValue(new Error("start failed")) };
    vi.mocked(create_channel_instance).mockReturnValue(mock_channel as any);

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.create({ instance_id: "ch1", provider: "slack" } as any);
    expect(result.ok).toBe(true);
  });

  it("enabled=false → channel 등록 안 함", async () => {
    let call_count = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      call_count++;
      return call_count === 1 ? null : make_config({ enabled: false });
    });
    vi.mocked(create_channel_instance).mockReturnValue(null);
    const channels = make_registry();

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.create({ instance_id: "ch1", provider: "slack" } as any);

    expect(result.ok).toBe(true);
    expect(channels.register).not.toHaveBeenCalled();
  });
});

// ── update() ─────────────────────────────────────────────────────────────────

describe("create_channel_ops — update()", () => {
  beforeEach(() => { vi.mocked(create_channel_instance).mockReset(); });

  it("존재하지 않는 instance_id → not_found", async () => {
    const instance_store = make_instance_store({ get_result: null });
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.update("unknown", {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("token 빈 문자열 → remove_token 호출", async () => {
    let get_call = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      get_call++;
      return get_call <= 1 ? make_config() : make_config({ enabled: false });
    });
    const channels = make_registry({
      channel_mock: { is_running: () => false, stop: vi.fn().mockResolvedValue(undefined) },
    });

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.update("ch1", { token: "" });

    expect(result.ok).toBe(true);
    expect(instance_store.remove_token).toHaveBeenCalledWith("ch1");
  });

  it("token 있음 → set_token 호출", async () => {
    let get_call = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      get_call++;
      return get_call <= 1 ? make_config() : make_config({ enabled: false });
    });
    const channels = make_registry({ channel_mock: null });

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    await ops.update("ch1", { token: "new-token" });

    expect(instance_store.set_token).toHaveBeenCalledWith("ch1", "new-token");
  });

  it("is_running → stop + unregister 후 재등록", async () => {
    const stop_fn = vi.fn().mockResolvedValue(undefined);
    let get_call = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      get_call++;
      return get_call <= 1 ? make_config() : make_config({ enabled: true });
    });
    const mock_channel = { instance_id: "ch1", start: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(create_channel_instance).mockReturnValue(mock_channel as any);

    const channels = make_registry({
      channel_mock: { is_running: () => true, stop: stop_fn },
    });

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.update("ch1", {});

    expect(stop_fn).toHaveBeenCalled();
    expect(channels.unregister).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("update 후 enabled=false → channel 등록 없음 (disabled 로그)", async () => {
    let get_call = 0;
    const instance_store = make_instance_store();
    instance_store.get.mockImplementation(() => {
      get_call++;
      return get_call <= 1 ? make_config() : make_config({ enabled: false });
    });
    vi.mocked(create_channel_instance).mockReturnValue(null);
    const channels = make_registry({ channel_mock: null });

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.update("ch1", { enabled: false });

    expect(result.ok).toBe(true);
    expect(channels.register).not.toHaveBeenCalled();
  });
});

// ── remove() ─────────────────────────────────────────────────────────────────

describe("create_channel_ops — remove()", () => {
  it("실행 중인 채널 stop → unregister → remove", async () => {
    const stop_fn = vi.fn().mockResolvedValue(undefined);
    const instance_store = make_instance_store({ remove_result: true });
    const channels = make_registry({
      channel_mock: { is_running: () => true, stop: stop_fn },
    });

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.remove("ch1");

    expect(stop_fn).toHaveBeenCalled();
    expect(channels.unregister).toHaveBeenCalledWith("ch1");
    expect(instance_store.remove_token).toHaveBeenCalledWith("ch1");
    expect(result.ok).toBe(true);
  });

  it("존재하지 않는 instance → ok=false, error=not_found", async () => {
    const instance_store = make_instance_store({ remove_result: false });
    const channels = make_registry({ channel_mock: null });

    const ops = create_channel_ops({ channels: channels as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.remove("ghost");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });
});

// ── test_connection() ────────────────────────────────────────────────────────

describe("create_channel_ops — test_connection()", () => {
  it("instance 없음 → instance_not_found", async () => {
    const instance_store = make_instance_store({ get_result: null });
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("unknown");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("instance_not_found");
  });

  it("token 없음 → token_not_configured", async () => {
    const instance_store = make_instance_store({ get_token_result: null });
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("token_not_configured");
  });

  it("지원하지 않는 provider → unsupported_provider", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "whatsapp" }) });
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unsupported_provider");
  });

  it("slack — HTTP ok + body.ok=true → ok:true + team detail", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "slack", settings: {} }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, team: "MyTeam" }),
    }));

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");

    expect(result.ok).toBe(true);
    expect(result.detail).toBe("MyTeam");
    vi.unstubAllGlobals();
  });

  it("slack — body.ok=false → ok:false + error", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "slack", settings: {} }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "invalid_auth" }),
    }));

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_auth");
    vi.unstubAllGlobals();
  });

  it("discord — HTTP ok → ok:true + username detail", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "discord", settings: {} }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: "BotName#1234" }),
    }));

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");

    expect(result.ok).toBe(true);
    expect(result.detail).toBe("BotName#1234");
    vi.unstubAllGlobals();
  });

  it("telegram — HTTP ok → ok:true + username detail", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "telegram", settings: {} }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { username: "MyBot" } }),
    }));

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");

    expect(result.ok).toBe(true);
    expect(result.detail).toBe("MyBot");
    vi.unstubAllGlobals();
  });

  it("HTTP 4xx → ok:false + error", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "slack", settings: {} }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    }));

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    vi.unstubAllGlobals();
  });

  it("fetch 예외 → ok:false + error", async () => {
    const instance_store = make_instance_store({ get_result: make_config({ provider: "slack", settings: {} }) });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const result = await ops.test_connection("ch1");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("network error");
    vi.unstubAllGlobals();
  });
});

// ── list_providers() ──────────────────────────────────────────────────────────

describe("create_channel_ops — list_providers()", () => {
  it("중복 제거된 provider 목록 반환", () => {
    const instance_store = make_instance_store({
      list_result: [
        make_config({ instance_id: "ch1", provider: "slack" }),
        make_config({ instance_id: "ch2", provider: "slack" }),
        make_config({ instance_id: "ch3", provider: "discord" }),
      ],
    });
    const ops = create_channel_ops({ channels: make_registry() as any, instance_store: instance_store as any, app_config: make_app_config() });
    const providers = ops.list_providers();
    expect(providers).toEqual(["slack", "discord"]);
  });
});
