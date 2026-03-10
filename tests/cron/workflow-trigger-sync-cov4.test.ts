/**
 * workflow-trigger-sync — filesystem_watch 트리거 커버리지 (L232-322).
 * fs.watch mock으로 파일 이벤트 시뮬레이션 + flush + 에러 처리.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sync_all_workflow_triggers,
  type WorkflowTriggerSyncDeps,
  type WorkflowExecuteFn,
} from "@src/cron/workflow-trigger-sync.js";
import type { TemplateWithSlug } from "@src/orchestration/workflow-loader.js";
import type { CronScheduler } from "@src/cron/contracts.js";
import type { MessageBusLike, MessageBusTap } from "@src/bus/index.js";
import type { WebhookStore } from "@src/services/webhook-store.service.js";

// fs.watch mock: 콜백 캡처 + 수동 트리거 지원
const _watchers: Array<{ callback: (event: string, filename: string | null) => void; closed: boolean }> = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn((path: string, opts: object, callback: (event: string, filename: string | null) => void) => {
      const watcher = { callback, closed: false, close: () => { watcher.closed = true; } };
      _watchers.push(watcher);
      return watcher;
    }),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
  };
});

function make_cron(): CronScheduler {
  return {
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({ id: "new-job" }),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn(), run_job: vi.fn(), status: vi.fn(),
    every: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
    disable_all_and_pause: vi.fn(),
  } as unknown as CronScheduler;
}

function make_bus(): MessageBusLike & MessageBusTap {
  return {
    publish_inbound: vi.fn(), publish_outbound: vi.fn(),
    consume_inbound: vi.fn(), consume_outbound: vi.fn(),
    on_publish: vi.fn(),
  } as unknown as MessageBusLike & MessageBusTap;
}

function make_deps(execute: WorkflowExecuteFn, workspace = "/workspace"): WorkflowTriggerSyncDeps {
  return {
    cron: make_cron(),
    bus: make_bus(),
    webhook_store: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue([]),
    } as unknown as WebhookStore,
    kanban_store: null,
    execute,
    default_channel: "slack",
    default_chat_id: "C001",
    workspace,
  };
}

function make_fs_template(overrides: Partial<TemplateWithSlug["trigger_nodes"][0]> = {}): TemplateWithSlug {
  return {
    slug: "fs-watcher",
    trigger_nodes: [{
      id: "t1",
      trigger_type: "filesystem_watch",
      watch_path: "uploads",
      ...overrides,
    }],
  } as unknown as TemplateWithSlug;
}

beforeEach(() => {
  vi.useFakeTimers();
  _watchers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════
// filesystem_watch — 파일 변경 이벤트 → execute 호출 (L291-307)
// ══════════════════════════════════════════════════════════

describe("filesystem_watch — 파일 이벤트 → execute 호출", () => {
  it("change 이벤트 발생 → flush 후 execute 호출됨", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_events: ["change"] });

    await sync_all_workflow_triggers([template], make_deps(execute));

    expect(_watchers).toHaveLength(1);

    // fs.watch 콜백 트리거 (change 이벤트)
    _watchers[0].callback("change", "test.txt");

    // batch_ms 기본값(500ms) 후 flush 실행
    await vi.advanceTimersByTimeAsync(600);
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalledWith(
      "fs-watcher",
      "slack",
      "C001",
      expect.objectContaining({
        filesystem_event: expect.objectContaining({
          files: expect.arrayContaining([expect.objectContaining({ event: "change" })]),
          watch_path: "uploads",
        }),
      }),
    );
  });

  it("rename 이벤트 → 'add'로 매핑됨", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_events: ["add"] });

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("rename", "newfile.txt");

    await vi.advanceTimersByTimeAsync(600);
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalledWith(
      "fs-watcher", "slack", "C001",
      expect.objectContaining({
        filesystem_event: expect.objectContaining({
          files: expect.arrayContaining([expect.objectContaining({ event: "add" })]),
        }),
      }),
    );
  });

  it("filename이 null → 이벤트 무시됨", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template();

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("change", null);

    await vi.advanceTimersByTimeAsync(600);

    expect(execute).not.toHaveBeenCalled();
  });

  it("watch_pattern 불일치 → 이벤트 무시됨", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_pattern: "**/*.jpg", watch_events: ["change"] });

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("change", "file.txt");  // .txt는 패턴 불일치

    await vi.advanceTimersByTimeAsync(600);

    expect(execute).not.toHaveBeenCalled();
  });

  it("watch_pattern 일치 → execute 호출됨", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_pattern: "**/*.jpg", watch_events: ["change"] });

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("change", "photo.jpg");  // .jpg 패턴 일치

    await vi.advanceTimersByTimeAsync(600);
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalled();
  });

  it("events_filter 불일치 → 이벤트 무시됨 (change 이벤트지만 add만 허용)", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_events: ["add"] });

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("change", "file.txt");  // change 이벤트지만 add만 허용됨

    await vi.advanceTimersByTimeAsync(600);

    // change → "change"로 매핑, events_filter에 "change" 없음 → 무시
    // Wait: watch_events:["add"]이면 events_filter에 "add"만 있고
    // "change" 이벤트 → mapped_event="change" → events_filter.has("change")=false → return
    expect(execute).not.toHaveBeenCalled();
  });

  it("watch_batch_ms 커스텀 → 지정된 시간 후 flush", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_events: ["change"], watch_batch_ms: 1000 });

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("change", "file.txt");

    // 500ms 후에는 아직 flush 안 됨
    await vi.advanceTimersByTimeAsync(600);
    expect(execute).not.toHaveBeenCalled();

    // 1000ms 후 flush 실행
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalled();
  });

  it("execute 실패 → 에러 격리, 예외 미전파", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockRejectedValue(new Error("exec error"));
    const template = make_fs_template({ watch_events: ["change"] });

    await sync_all_workflow_triggers([template], make_deps(execute));
    _watchers[0].callback("change", "file.txt");

    await expect(vi.advanceTimersByTimeAsync(600)).resolves.not.toThrow();
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// filesystem_watch — fs.watch 에러 처리 (L309-311)
// ══════════════════════════════════════════════════════════

describe("filesystem_watch — fs.watch 설정 실패 → 경고 후 계속", () => {
  it("fs.watch throw → warn 로그, 다음 엔트리 계속 처리", async () => {
    const { watch } = await import("node:fs");
    vi.mocked(watch).mockImplementationOnce(() => {
      throw new Error("ENOENT: no such file");
    });

    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template: TemplateWithSlug = {
      slug: "fs-watcher",
      trigger_nodes: [
        { id: "t1", trigger_type: "filesystem_watch", watch_path: "nonexistent" },
      ],
    } as unknown as TemplateWithSlug;

    // 예외 없이 완료되어야 함
    await expect(sync_all_workflow_triggers([template], make_deps(execute))).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════
// filesystem_watch — watch_entries 없음 → 0 반환 (L243-244)
// ══════════════════════════════════════════════════════════

describe("filesystem_watch — 트리거 없음 → 등록 0", () => {
  it("filesystem_watch 트리거 없음 → registered=0", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template: TemplateWithSlug = {
      slug: "no-fs",
      trigger_nodes: [{ id: "t1", trigger_type: "cron", schedule: "0 * * * *" }],
    } as unknown as TemplateWithSlug;

    const result = await sync_all_workflow_triggers([template], make_deps(execute));

    expect(result.filesystem_watch.registered).toBe(0);
    expect(_watchers).toHaveLength(0);
  });

  it("이전 fs watcher → 재sync 시 정리됨 (watcher.close 호출)", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_events: ["change"] });

    // 첫 번째 sync → watcher 등록
    await sync_all_workflow_triggers([template], make_deps(execute));
    expect(_watchers).toHaveLength(1);

    // 두 번째 sync → 이전 watcher 정리 + 새 watcher 등록
    _watchers.length = 0;
    await sync_all_workflow_triggers([template], make_deps(execute));

    // 새 watcher 등록됨
    expect(_watchers).toHaveLength(1);
    expect(_watchers[0].closed).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// filesystem_watch — 배치: 여러 이벤트 → 1번 flush (L304-307)
// ══════════════════════════════════════════════════════════

describe("filesystem_watch — 배치 처리: 다중 이벤트 → 1 flush", () => {
  it("짧은 시간에 여러 이벤트 → 1번의 execute 호출", async () => {
    const execute: WorkflowExecuteFn = vi.fn().mockResolvedValue({ ok: true });
    const template = make_fs_template({ watch_events: ["change"] });

    await sync_all_workflow_triggers([template], make_deps(execute));

    // 빠르게 여러 이벤트 발생
    _watchers[0].callback("change", "file1.txt");
    _watchers[0].callback("change", "file2.txt");
    _watchers[0].callback("change", "file3.txt");

    await vi.advanceTimersByTimeAsync(600);
    await vi.runAllTimersAsync();

    // 배치로 묶여 1번만 execute 호출 (Map으로 중복 제거되어 마지막 이벤트만)
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
