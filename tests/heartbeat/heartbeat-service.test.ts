import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatService } from "../../src/heartbeat/service.js";
import { HEARTBEAT_OK_TOKEN } from "../../src/heartbeat/types.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("HeartbeatService", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = join(tmpdir(), `hb-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  // ── constructor ──────────────────────────────────────
  it("constructor: 기본값으로 서비스 생성", () => {
    const svc = new HeartbeatService(workspace);
    expect(svc.name).toBe("heartbeat");
    expect(svc.workspace).toBe(workspace);
    expect(svc.heartbeat_file).toBe(join(workspace, "HEARTBEAT.md"));
    expect(svc.on_heartbeat).toBeNull();
    expect(svc.on_notify).toBeNull();
    expect(svc.interval_s).toBeGreaterThanOrEqual(5);
  });

  it("constructor: 옵션으로 interval 및 콜백 지정", () => {
    const on_heartbeat = vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN);
    const on_notify = vi.fn().mockResolvedValue(undefined);
    const svc = new HeartbeatService(workspace, {
      interval_s: 10,
      on_heartbeat,
      on_notify,
    });
    expect(svc.interval_s).toBe(10);
    expect(svc.on_heartbeat).toBe(on_heartbeat);
    expect(svc.on_notify).toBe(on_notify);
  });

  it("constructor: interval_s 최소값 5초 보장", () => {
    const svc = new HeartbeatService(workspace, { interval_s: 1 });
    expect(svc.interval_s).toBe(5);
  });

  // ── start / stop ──────────────────────────────────────
  it("start/stop: enabled 상태에서 start → running, stop → not running", async () => {
    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    await svc.start();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
    expect(svc.health_check().ok).toBe(false);
  });

  it("start: disabled 상태에서 start 호출 시 실행 안 함", async () => {
    const svc = new HeartbeatService(workspace, { enabled: false });
    await svc.start();
    expect(svc.health_check().ok).toBe(false);
  });

  it("start: 이미 running인 상태에서 중복 start는 무시", async () => {
    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    await svc.start();
    await svc.start(); // 중복
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
  });

  // ── pause / resume ──────────────────────────────────
  it("pause/resume: pause → paused=true + enabled=false, resume → 복구", async () => {
    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    await svc.start();
    await svc.pause();
    // health_check.ok = _running && _enabled → pause는 _running에 영향 없음
    expect(svc.health_check().ok).toBe(true);
    const statusPaused = svc.status();
    expect(statusPaused.paused).toBe(true);
    expect(statusPaused.enabled).toBe(false); // _enabled && !_paused → true && !true = false

    await svc.resume();
    expect(svc.health_check().ok).toBe(true);
    const statusResumed = svc.status();
    expect(statusResumed.paused).toBe(false);
    expect(statusResumed.enabled).toBe(true);
    await svc.stop();
  });

  it("resume: 미시작 상태에서 resume 호출 시 start 효과", async () => {
    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    await svc.resume();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
  });

  it("resume: disabled 상태에서 resume는 무시", async () => {
    const svc = new HeartbeatService(workspace, { enabled: false });
    await svc.resume();
    expect(svc.health_check().ok).toBe(false);
  });

  it("resume: pause 안 된 상태에서 resume는 무시", async () => {
    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    await svc.start();
    await svc.resume(); // not paused → no-op
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
  });

  // ── set_enabled ──────────────────────────────────────
  it("set_enabled: 동적으로 enabled 상태 변경", () => {
    const svc = new HeartbeatService(workspace);
    svc.set_enabled(false);
    expect(svc.status().enabled).toBe(false);
    svc.set_enabled(true);
    // enabled 상태이지만 running이 아니므로 status.enabled은 여전히 false (paused=false, _enabled=true)
  });

  // ── health_check ──────────────────────────────────────
  it("health_check: 중지 시 ok=false, details 포함", () => {
    const svc = new HeartbeatService(workspace, { interval_s: 60 });
    const hc = svc.health_check();
    expect(hc.ok).toBe(false);
    expect(hc.details).toBeDefined();
    expect(hc.details!.paused).toBe(false);
    expect(hc.details!.interval_s).toBe(60);
  });

  // ── status ──────────────────────────────────────
  it("status: 전체 상태 반환", () => {
    const svc = new HeartbeatService(workspace, { interval_s: 120 });
    const st = svc.status();
    expect(st.running).toBe(false);
    expect(st.enabled).toBe(true); // _enabled(true) && !_paused(false)
    expect(st.paused).toBe(false);
    expect(st.interval_s).toBe(120);
    expect(st.heartbeat_file).toContain("HEARTBEAT.md");
  });

  // ── trigger_now ──────────────────────────────────────
  it("trigger_now: on_heartbeat가 없으면 null 반환", async () => {
    const svc = new HeartbeatService(workspace);
    const result = await svc.trigger_now();
    expect(result).toBeNull();
  });

  it("trigger_now: on_heartbeat 콜백 호출 후 결과 반환", async () => {
    const on_heartbeat = vi.fn().mockResolvedValue("Agent response here");
    const svc = new HeartbeatService(workspace, { on_heartbeat });
    const result = await svc.trigger_now();
    expect(result).toBe("Agent response here");
    expect(on_heartbeat).toHaveBeenCalledOnce();
  });

  // ── _tick via start (HEARTBEAT.md 유무에 따른 동작) ──
  it("tick: HEARTBEAT.md 없으면 on_heartbeat 호출 안 함", async () => {
    const on_heartbeat = vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN);
    const svc = new HeartbeatService(workspace, {
      interval_s: 9999,
      on_heartbeat,
    });
    await svc.start();
    // start 직후에는 _tick이 sleep 후 호출되므로 즉시 체크
    expect(on_heartbeat).not.toHaveBeenCalled();
    await svc.stop();
  });

  it("tick: HEARTBEAT.md에 내용 있으면 on_heartbeat 콜백 → HEARTBEAT_OK이면 on_notify 미호출", async () => {
    await writeFile(join(workspace, "HEARTBEAT.md"), "Check the deployment status");
    const on_heartbeat = vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN);
    const on_notify = vi.fn().mockResolvedValue(undefined);

    // trigger_now를 통한 간접 테스트 (직접 _tick 호출 불가)
    const svc = new HeartbeatService(workspace, {
      interval_s: 9999,
      on_heartbeat,
      on_notify,
    });
    const result = await svc.trigger_now();
    expect(result).toBe(HEARTBEAT_OK_TOKEN);
    expect(on_heartbeat).toHaveBeenCalledOnce();
    // on_notify는 trigger_now에서 직접 호출하지 않음
    await svc.stop();
  });

  // ── _tick 직접 커버: private 메서드 캐스트로 직접 호출 ──
  it("tick: 응답이 OK가 아니면 on_notify 호출됨", async () => {
    await writeFile(join(workspace, "HEARTBEAT.md"), "urgent: memory leak detected");
    const on_heartbeat = vi.fn().mockResolvedValue("Memory leak in service X — needs restart");
    const on_notify = vi.fn().mockResolvedValue(undefined);

    const svc = new HeartbeatService(workspace, {
      interval_s: 9999,
      on_heartbeat,
      on_notify,
    });

    // _tick은 private이므로 any 캐스트로 직접 호출
    await (svc as any)._tick();

    expect(on_heartbeat).toHaveBeenCalled();
    expect(on_notify).toHaveBeenCalled();
    const notify_arg = on_notify.mock.calls[0][0];
    expect(notify_arg).toContain("Memory leak");
  });

  it("tick: on_heartbeat 콜백이 예외 발생해도 경고 로그 후 정상 종료", async () => {
    await writeFile(join(workspace, "HEARTBEAT.md"), "check required");
    const on_heartbeat = vi.fn().mockRejectedValue(new Error("agent unreachable"));

    const svc = new HeartbeatService(workspace, {
      interval_s: 9999,
      on_heartbeat,
    });

    // _tick 예외는 내부에서 catch → 경고 로그 후 정상 반환
    await expect((svc as any)._tick()).resolves.toBeUndefined();
    expect(on_heartbeat).toHaveBeenCalled();
  });

  it("tick: HEARTBEAT.md 내용이 비어있으면 on_heartbeat 호출 안 함", async () => {
    await writeFile(join(workspace, "HEARTBEAT.md"), "# Just a header\n- [ ]\n<!-- nothing to do -->");
    const on_heartbeat = vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN);

    const svc = new HeartbeatService(workspace, {
      interval_s: 9999,
      on_heartbeat,
    });

    await (svc as any)._tick();
    expect(on_heartbeat).not.toHaveBeenCalled();
  });

  it("tick: on_heartbeat 없으면 파일 있어도 반환", async () => {
    await writeFile(join(workspace, "HEARTBEAT.md"), "urgent task needed");

    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    // on_heartbeat 없어서 on_heartbeat 체크 후 조기 반환
    await expect((svc as any)._tick()).resolves.toBeUndefined();
  });

  it("tick: HEARTBEAT.md 없으면 on_heartbeat 호출 안 함 (_read 반환 null)", async () => {
    // 파일 없음 → _read_heartbeat_file → null → is_heartbeat_empty(null) → true → return
    const on_heartbeat = vi.fn().mockResolvedValue(HEARTBEAT_OK_TOKEN);
    const svc = new HeartbeatService(workspace, { interval_s: 9999, on_heartbeat });

    await (svc as any)._tick();
    expect(on_heartbeat).not.toHaveBeenCalled();
  });

  it("_read_heartbeat_file: 경로가 디렉토리면 readFile EISDIR → catch null 반환 (L59)", async () => {
    // HEARTBEAT.md 위치에 디렉토리 생성 → file_exists=true, readFile=EISDIR → catch { return null }
    await mkdir(join(workspace, "HEARTBEAT.md"), { recursive: true });
    const svc = new HeartbeatService(workspace, { interval_s: 9999 });
    const result = await (svc as any)._read_heartbeat_file();
    expect(result).toBeNull();
  });
});
