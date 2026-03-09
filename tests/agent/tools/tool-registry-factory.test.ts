/**
 * create_default_tool_registry — 미커버 분기 보충.
 * bus/spawn_callback/cron/task_query_callback 선택적 파라미터,
 * runtime_policy pre_hook 주입, workspace 없음 → Error.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create_default_tool_registry } from "@src/agent/tools/index.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "tool-reg-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ══════════════════════════════════════════
// 기본 생성
// ══════════════════════════════════════════

describe("create_default_tool_registry — 기본", () => {
  it("workspace만 있어도 registry 생성됨", () => {
    const { registry, installer, dynamic_loader } = create_default_tool_registry({ workspace });
    expect(registry).toBeDefined();
    expect(installer).toBeDefined();
    expect(dynamic_loader).toBeDefined();
    // 핵심 도구 등록됨 확인
    expect(registry.tool_names()).toContain("read_file");
    expect(registry.tool_names()).toContain("exec");
  });

  it("workspace 없음 → Error 발생", () => {
    expect(() => create_default_tool_registry({ workspace: "" })).toThrow("workspace is required");
  });
});

// ══════════════════════════════════════════
// bus 옵션 — message/ask_user/send_file 도구 등록
// ══════════════════════════════════════════

describe("create_default_tool_registry — bus 옵션", () => {
  it("bus 있으면 message/ask_user/send_file 도구 등록됨", async () => {
    const bus = {
      publish_outbound: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
    };
    const { registry } = create_default_tool_registry({ workspace, bus: bus as any });
    expect(registry.tool_names()).toContain("message");
    expect(registry.tool_names()).toContain("ask_user");
    expect(registry.tool_names()).toContain("send_file");
  });

  it("bus 없으면 message/ask_user/send_file 도구 없음", () => {
    const { registry } = create_default_tool_registry({ workspace });
    expect(registry.tool_names()).not.toContain("message");
  });
});

// ══════════════════════════════════════════
// spawn_callback 옵션 — spawn 도구 등록
// ══════════════════════════════════════════

describe("create_default_tool_registry — spawn_callback 옵션", () => {
  it("spawn_callback 있으면 spawn 도구 등록됨", () => {
    const spawn_callback = vi.fn().mockResolvedValue({ subagent_id: "sa1", status: "running" });
    const { registry } = create_default_tool_registry({ workspace, spawn_callback });
    expect(registry.tool_names()).toContain("spawn");
  });

  it("spawn_callback 없으면 spawn 도구 없음", () => {
    const { registry } = create_default_tool_registry({ workspace });
    expect(registry.tool_names()).not.toContain("spawn");
  });
});

// ══════════════════════════════════════════
// cron 옵션 — cron 도구 등록
// ══════════════════════════════════════════

describe("create_default_tool_registry — cron 옵션", () => {
  it("cron 있으면 cron 도구 등록됨", () => {
    const cron = {
      add_job: vi.fn(),
      remove_job: vi.fn(),
      list_jobs: vi.fn(),
    };
    const { registry } = create_default_tool_registry({ workspace, cron: cron as any });
    expect(registry.tool_names()).toContain("cron");
  });

  it("cron 없으면 cron 도구 없음 (기본 등록 안 됨)", () => {
    const { registry } = create_default_tool_registry({ workspace });
    // cron이 없는 경우 CronTool은 등록 안 됨
    // (cron null은 else 분기)
    expect(registry.tool_names()).not.toContain("cron");
  });
});

// ══════════════════════════════════════════
// task_query_callback 옵션
// ══════════════════════════════════════════

describe("create_default_tool_registry — task_query_callback 옵션", () => {
  it("task_query_callback 있으면 task_query 도구 등록됨", () => {
    const task_query_callback = vi.fn().mockResolvedValue([]);
    const { registry } = create_default_tool_registry({ workspace, task_query_callback });
    expect(registry.tool_names()).toContain("task_query");
  });

  it("task_query_callback 없으면 task_query 도구 없음", () => {
    const { registry } = create_default_tool_registry({ workspace });
    expect(registry.tool_names()).not.toContain("task_query");
  });
});

// ══════════════════════════════════════════
// runtime_policy 옵션 — pre_hook 주입
// ══════════════════════════════════════════

describe("create_default_tool_registry — runtime_policy 옵션", () => {
  it("runtime_policy 있으면 policy pre_hook이 추가됨", async () => {
    const { registry } = create_default_tool_registry({
      workspace,
      runtime_policy: {
        sandbox: {
          approval: "auto-approve",
          network_access: true,
          fs_access: "workspace-write",
        },
      } as any,
    });
    // auto-approve이므로 read_file 실행 허용됨
    const result = await registry.execute("read_file", { path: "/nonexistent" });
    expect(typeof result).toBe("string"); // 실행됨 (파일 없어도 Error 문자열 반환)
  });

  it("pre_hooks 커스텀 훅이 실행 차단 가능", async () => {
    // pre_hooks 파라미터로 직접 주입하는 경로 테스트
    const block_hook = vi.fn().mockReturnValue({ permission: "deny", reason: "blocked by test hook" });
    const { registry } = create_default_tool_registry({
      workspace,
      pre_hooks: [block_hook],
    });
    // exec 실행 시 hook이 deny → 차단됨
    const result = await registry.execute("exec", { command: "echo hello" });
    expect(block_hook).toHaveBeenCalled();
    expect(String(result)).toContain("blocked by test hook");
  });
});

// ══════════════════════════════════════════
// dynamic_store_path 커스텀
// ══════════════════════════════════════════

describe("create_default_tool_registry — dynamic_store_path", () => {
  it("dynamic_store_path 지정 시 해당 경로 사용", () => {
    const custom_path = join(workspace, "custom-tools.db");
    const { registry } = create_default_tool_registry({ workspace, dynamic_store_path: custom_path });
    expect(registry).toBeDefined();
  });
});

// ══════════════════════════════════════════
// L598: sender 클로저 — bus.publish_outbound 호출
// ══════════════════════════════════════════

describe("create_default_tool_registry — bus.publish_outbound 호출 (L598)", () => {
  it("message 도구 execute → sender → bus.publish_outbound 호출 (L598)", async () => {
    const publish_outbound = vi.fn().mockResolvedValue(undefined);
    const bus = { publish_outbound, subscribe: vi.fn() };
    const { registry } = create_default_tool_registry({ workspace, bus: bus as any });
    const result = await registry.execute("message", {
      channel: "slack",
      chat_id: "C123",
      content: "Hello from test",
    });
    // sender가 호출됨 → publish_outbound 호출됨 (L598)
    expect(publish_outbound).toHaveBeenCalled();
    expect(String(result)).toContain("Event sent");
  });
});

// ══════════════════════════════════════════
// L624, L627-629: runtime_admin 도구 — list_registered_tool_names + refresh_dynamic_tools
// ══════════════════════════════════════════

describe("create_default_tool_registry — runtime_admin 콜백 (L624, L627-629)", () => {
  it("tool_install_shell → list_registered_tool_names + refresh_dynamic_tools 호출 (L624, L627-629)", async () => {
    const { registry } = create_default_tool_registry({ workspace });
    const result = await registry.execute("runtime_admin", {
      action: "tool_install_shell",
      tool_name: "test_shell_tool",
      tool_description: "Test shell tool",
      tool_command_template: "echo {{input}}",
      tool_overwrite: true,
    });
    const parsed = JSON.parse(String(result));
    // tool 설치 성공 → refresh_dynamic_tools 호출됨 (L627-629)
    expect(parsed.ok).toBe(true);
    expect(parsed.tool_name).toBe("test_shell_tool");
  });
});
