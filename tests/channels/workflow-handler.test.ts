/**
 * WorkflowHandler — can_handle / handle 전체 경로 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { WorkflowHandler, type WorkflowAccess } from "@src/channels/commands/workflow.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";

type WorkflowRunInfo = {
  workflow_id: string;
  title: string;
  status: string;
  created_at?: string;
  current_phase?: number;
};

// ── 헬퍼 ────────────────────────────────────────

function make_ctx(
  command_name: string,
  args: string[],
  provider = "slack",
  sender_id = "U001",
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

function make_run(overrides: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo {
  return {
    workflow_id: "wf-001",
    title: "테스트 워크플로우",
    status: "running",
    ...overrides,
  };
}

function make_access(overrides: Partial<WorkflowAccess> = {}): WorkflowAccess {
  return {
    list_runs: vi.fn().mockResolvedValue([]),
    get_run: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ ok: true, workflow_id: "wf-123" }),
    cancel: vi.fn().mockResolvedValue(true),
    list_templates: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

// ══════════════════════════════════════════
// can_handle
// ══════════════════════════════════════════

describe("WorkflowHandler — can_handle", () => {
  it("'workflow' → true", () => {
    const h = new WorkflowHandler(make_access());
    expect(h.can_handle(make_ctx("workflow", []))).toBe(true);
  });

  it("'wf' → true", () => {
    const h = new WorkflowHandler(make_access());
    expect(h.can_handle(make_ctx("wf", []))).toBe(true);
  });

  it("'워크플로우' → true", () => {
    const h = new WorkflowHandler(make_access());
    expect(h.can_handle(make_ctx("워크플로우", []))).toBe(true);
  });

  it("'워플' → true", () => {
    const h = new WorkflowHandler(make_access());
    expect(h.can_handle(make_ctx("워플", []))).toBe(true);
  });

  it("'help' → false", () => {
    const h = new WorkflowHandler(make_access());
    expect(h.can_handle(make_ctx("help", []))).toBe(false);
  });

  it("command 없음 → false", () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", []);
    (ctx as any).command = undefined;
    expect(h.can_handle(ctx)).toBe(false);
  });
});

// ══════════════════════════════════════════
// handle — action 없음
// ══════════════════════════════════════════

describe("WorkflowHandler — action 없음", () => {
  it("args 없음 → 가이드 또는 기본 처리", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", []);
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// handle — list / 목록
// ══════════════════════════════════════════

describe("WorkflowHandler — list 액션", () => {
  it("실행 중인 워크플로우 없음 → '없습니다' 포함", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });

  it("워크플로우 목록 → workflow_id / title / status 포함", async () => {
    const runs = [make_run({ workflow_id: "wf-abc", title: "My Flow", status: "completed" })];
    const h = new WorkflowHandler(make_access({ list_runs: vi.fn().mockResolvedValue(runs) }));
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("wf-abc");
    expect(ctx.replies[0]).toContain("My Flow");
    expect(ctx.replies[0]).toContain("completed");
  });

  it("status running → 🔄 아이콘", async () => {
    const runs = [make_run({ status: "running" })];
    const h = new WorkflowHandler(make_access({ list_runs: vi.fn().mockResolvedValue(runs) }));
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("\u{1F504}");
  });

  it("status failed → ❌ 아이콘", async () => {
    const runs = [make_run({ status: "failed" })];
    const h = new WorkflowHandler(make_access({ list_runs: vi.fn().mockResolvedValue(runs) }));
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("\u274C");
  });

  it("알 수 없는 status → ❓ 아이콘", async () => {
    const runs = [make_run({ status: "unknown_state" })];
    const h = new WorkflowHandler(make_access({ list_runs: vi.fn().mockResolvedValue(runs) }));
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("\u2753");
  });

  it("title 없음 → (untitled) 표시", async () => {
    const runs = [make_run({ title: "" })];
    const h = new WorkflowHandler(make_access({ list_runs: vi.fn().mockResolvedValue(runs) }));
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("(untitled)");
  });

  it("16개 이상 → 15개 제한 + '외 N개' 표시", async () => {
    const runs = Array.from({ length: 18 }, (_, i) => make_run({ workflow_id: `wf-${i}`, status: "completed" }));
    const h = new WorkflowHandler(make_access({ list_runs: vi.fn().mockResolvedValue(runs) }));
    const ctx = make_ctx("workflow", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("외 3개");
  });

  it("목록 alias → list와 동일 처리", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["목록"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });
});

// ══════════════════════════════════════════
// handle — status / 상태
// ══════════════════════════════════════════

describe("WorkflowHandler — status 액션", () => {
  it("id 없음 → usage 안내", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["status"]);
    await h.handle(ctx);
    // usage 포함 여부 (format_subcommand_usage 반환값 의존)
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("id 있지만 존재하지 않음 → '찾을 수 없습니다' 포함", async () => {
    const h = new WorkflowHandler(make_access({ get_run: vi.fn().mockResolvedValue(null) }));
    const ctx = make_ctx("workflow", ["status", "wf-999"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("찾을 수 없습니다");
    expect(ctx.replies[0]).toContain("wf-999");
  });

  it("id 있고 존재 → 상세 정보 포함", async () => {
    const run = make_run({ workflow_id: "wf-001", title: "My Flow", status: "completed", created_at: "2024-01-01" });
    const h = new WorkflowHandler(make_access({ get_run: vi.fn().mockResolvedValue(run) }));
    const ctx = make_ctx("workflow", ["status", "wf-001"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("wf-001");
    expect(ctx.replies[0]).toContain("My Flow");
    expect(ctx.replies[0]).toContain("completed");
    expect(ctx.replies[0]).toContain("2024-01-01");
  });

  it("current_phase 있음 → phase 표시", async () => {
    const run = make_run({ status: "running", current_phase: 3 });
    const h = new WorkflowHandler(make_access({ get_run: vi.fn().mockResolvedValue(run) }));
    const ctx = make_ctx("workflow", ["status", "wf-001"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("phase: 3");
  });

  it("current_phase 없음 → phase 행 없음", async () => {
    const run = make_run({ status: "running" });
    const h = new WorkflowHandler(make_access({ get_run: vi.fn().mockResolvedValue(run) }));
    const ctx = make_ctx("workflow", ["status", "wf-001"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).not.toContain("phase:");
  });

  it("상태 alias → status와 동일 처리", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["상태"]);
    await h.handle(ctx);
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// handle — run / 실행
// ══════════════════════════════════════════

describe("WorkflowHandler — run 액션", () => {
  it("objective 없음 → usage 안내", async () => {
    const access = make_access();
    const h = new WorkflowHandler(access);
    const ctx = make_ctx("workflow", ["run"]);
    await h.handle(ctx);
    expect((access.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("공백만인 objective → usage 안내", async () => {
    const access = make_access();
    const h = new WorkflowHandler(access);
    const ctx = make_ctx("workflow", ["run", "   "]);
    await h.handle(ctx);
    expect((access.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("성공 → workflow_id 포함 메시지", async () => {
    const h = new WorkflowHandler(make_access({ create: vi.fn().mockResolvedValue({ ok: true, workflow_id: "wf-new" }) }));
    const ctx = make_ctx("workflow", ["run", "analyze", "sales", "data"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("wf-new");
    expect(ctx.replies[0]).toContain("✅");
  });

  it("실패 → error 메시지 포함", async () => {
    const h = new WorkflowHandler(make_access({ create: vi.fn().mockResolvedValue({ ok: false, error: "quota exceeded" }) }));
    const ctx = make_ctx("workflow", ["run", "do something"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("quota exceeded");
    expect(ctx.replies[0]).toContain("❌");
  });

  it("실패 + error 없음 → 'unknown' 표시", async () => {
    const h = new WorkflowHandler(make_access({ create: vi.fn().mockResolvedValue({ ok: false }) }));
    const ctx = make_ctx("workflow", ["run", "do something"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("unknown");
  });

  it("objective → 60자까지 title로 전달", async () => {
    const access = make_access();
    const h = new WorkflowHandler(access);
    const long_text = "a".repeat(100);
    const ctx = make_ctx("workflow", ["run", long_text]);
    await h.handle(ctx);
    const call = (access.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.title.length).toBeLessThanOrEqual(60);
  });

  it("실행 alias → run과 동일 처리", async () => {
    const access = make_access();
    const h = new WorkflowHandler(access);
    const ctx = make_ctx("workflow", ["실행", "do something"]);
    await h.handle(ctx);
    expect((access.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// handle — cancel / 취소
// ══════════════════════════════════════════

describe("WorkflowHandler — cancel 액션", () => {
  it("id 없음 → usage 안내", async () => {
    const access = make_access();
    const h = new WorkflowHandler(access);
    const ctx = make_ctx("workflow", ["cancel"]);
    await h.handle(ctx);
    expect((access.cancel as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("id 있고 성공 → '취소됨' 포함", async () => {
    const h = new WorkflowHandler(make_access({ cancel: vi.fn().mockResolvedValue(true) }));
    const ctx = make_ctx("workflow", ["cancel", "wf-001"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("wf-001");
    expect(ctx.replies[0]).toContain("✅");
  });

  it("id 있고 실패 → '취소할 수 없습니다' 포함", async () => {
    const h = new WorkflowHandler(make_access({ cancel: vi.fn().mockResolvedValue(false) }));
    const ctx = make_ctx("workflow", ["cancel", "wf-001"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("취소할 수 없습니다");
    expect(ctx.replies[0]).toContain("wf-001");
  });

  it("취소 alias → cancel과 동일 처리", async () => {
    const access = make_access({ cancel: vi.fn().mockResolvedValue(true) });
    const h = new WorkflowHandler(access);
    const ctx = make_ctx("workflow", ["취소", "wf-002"]);
    await h.handle(ctx);
    expect((access.cancel as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("wf-002");
  });
});

// ══════════════════════════════════════════
// handle — templates / 템플릿
// ══════════════════════════════════════════

describe("WorkflowHandler — templates 액션", () => {
  it("템플릿 없음 → '없습니다' 포함", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["templates"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });

  it("템플릿 있음 → slug/title 포함", async () => {
    const h = new WorkflowHandler(make_access({
      list_templates: vi.fn().mockReturnValue([
        { slug: "data-analysis", title: "데이터 분석" },
        { slug: "report-gen", title: "보고서 생성" },
      ]),
    }));
    const ctx = make_ctx("workflow", ["templates"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("data-analysis");
    expect(ctx.replies[0]).toContain("데이터 분석");
  });

  it("21개 이상 → 20개 제한", async () => {
    const templates = Array.from({ length: 25 }, (_, i) => ({ slug: `slug-${i}`, title: `Title ${i}` }));
    const h = new WorkflowHandler(make_access({ list_templates: vi.fn().mockReturnValue(templates) }));
    const ctx = make_ctx("workflow", ["templates"]);
    await h.handle(ctx);
    const reply = ctx.replies[0]!;
    const item_count = reply.split("\n").filter((l) => l.startsWith("- `slug-")).length;
    expect(item_count).toBeLessThanOrEqual(20);
  });

  it("템플릿 alias → templates와 동일 처리", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["템플릿"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없습니다");
  });
});

// ══════════════════════════════════════════
// handle — 알 수 없는 action
// ══════════════════════════════════════════

describe("WorkflowHandler — 알 수 없는 action", () => {
  it("unknown action → 가이드 반환", async () => {
    const h = new WorkflowHandler(make_access());
    const ctx = make_ctx("workflow", ["unknown_action_xyz"]);
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});
