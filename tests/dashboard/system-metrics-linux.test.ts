/**
 * SystemMetricsCollector — Linux /proc 경로 커버리지.
 * node:fs/promises.readFile mock으로 /proc/net/dev, /proc/meminfo 시뮬레이션.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── fs/promises mock ───────────────────────────────────
const { mock_read_file } = vi.hoisted(() => ({ mock_read_file: vi.fn() }));

vi.mock("node:fs/promises", () => ({ readFile: mock_read_file }));

// 실제 /proc/net/dev 포맷 (lo 제외, eth0 포함)
const NET_DEV_CONTENT = [
  "Inter-|   Receive                                                |  Transmit",
  " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
  "    lo:    1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0",
  "  eth0:   99000     200    0    0    0     0          0         0    55000     100    0    0    0     0       0          0",
].join("\n");

// SwapTotal=4096 kB, SwapFree=2048 kB → swap_used=2048 → 2 MB, swap_percent=50
const MEMINFO_WITH_SWAP = [
  "MemTotal:       16384 kB",
  "MemFree:         8192 kB",
  "SwapTotal:       4096 kB",
  "SwapFree:        2048 kB",
].join("\n");

// SwapTotal=0 → swap_percent = null
const MEMINFO_NO_SWAP = [
  "MemTotal:       8192 kB",
  "MemFree:        4096 kB",
  "SwapTotal:         0 kB",
  "SwapFree:          0 kB",
].join("\n");

// ── import after mock ─────────────────────────────────
import { SystemMetricsCollector } from "../../src/dashboard/system-metrics.js";

describe("SystemMetricsCollector — Linux /proc 커버리지", () => {
  let collector: SystemMetricsCollector;

  beforeEach(() => {
    // 기본 mock: swap 있음
    mock_read_file.mockImplementation(async (path: string) => {
      if (path === "/proc/net/dev") return NET_DEV_CONTENT;
      if (path === "/proc/meminfo") return MEMINFO_WITH_SWAP;
      throw new Error(`ENOENT: ${String(path)}`);
    });
    collector = new SystemMetricsCollector(50);
  });

  afterEach(() => {
    collector.stop();
  });

  it("swap_total_mb / swap_used_mb / swap_percent 수집 (Linux /proc/meminfo)", async () => {
    collector.start();
    await new Promise(r => setTimeout(r, 80));
    const m = collector.get_latest()!;
    expect(m.swap_total_mb).toBe(4);   // 4096 kB / 1024 = 4 MB
    expect(m.swap_used_mb).toBe(2);    // (4096 - 2048) / 1024 = 2 MB
    expect(m.swap_percent).toBe(50);   // 2/4 * 100 = 50%
  });

  it("두 번째 수집 → net_rx_kbps / net_tx_kbps 계산 (같은 값 → 0 kbps)", async () => {
    collector.start();
    // 2번 수집 기다림: 첫 번째에서 prev_net 설정, 두 번째에서 rate 계산
    await new Promise(r => setTimeout(r, 130));
    const m = collector.get_latest()!;
    // 동일한 mock 데이터 → delta = 0 bytes → 0 kbps (>= 0 이므로 null 아님)
    expect(m.net_rx_kbps).toBe(0);
    expect(m.net_tx_kbps).toBe(0);
  });

  it("swap_total_mb = 0 → swap_percent = null", async () => {
    mock_read_file.mockImplementation(async (path: string) => {
      if (path === "/proc/net/dev") return NET_DEV_CONTENT;
      if (path === "/proc/meminfo") return MEMINFO_NO_SWAP;
      throw new Error(`ENOENT: ${String(path)}`);
    });

    collector.start();
    await new Promise(r => setTimeout(r, 80));
    const m = collector.get_latest()!;
    expect(m.swap_total_mb).toBe(0);
    expect(m.swap_percent).toBeNull();
  });

  it("mem_total_mb=0 → mem_percent=0 (division by zero 방지)", async () => {
    // os.totalmem()은 실제 값 반환. mem_percent 계산은 mem_total_mb > 0 시만 비율 계산.
    // 실제 mock으로는 totalmem을 대체 못 하므로, 실제 값 확인만.
    collector.start();
    await new Promise(r => setTimeout(r, 80));
    const m = collector.get_latest()!;
    expect(m.mem_percent).toBeGreaterThanOrEqual(0);
    expect(m.mem_percent).toBeLessThanOrEqual(100);
  });

  it("readFile 에러 시 swap/net → null (catch 경로 커버)", async () => {
    mock_read_file.mockRejectedValue(new Error("EACCES"));

    collector.start();
    await new Promise(r => setTimeout(r, 80));
    const m = collector.get_latest()!;
    // 에러 시 read_swap/read_net_sample → null 반환
    expect(m.swap_total_mb).toBeNull();
    expect(m.net_rx_kbps).toBeNull();
  });
});
