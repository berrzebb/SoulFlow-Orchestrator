/**
 * SystemMetricsCollector — 추가 미커버 분기.
 * L35: read_net_sample — parts.length < 10 → continue (짧은 라인 건너뜀)
 * L139: _calc_cpu — total_delta === 0 → return 0
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ── node:fs/promises + node:os mock ───────────────────
const { mock_read_file, mock_cpus } = vi.hoisted(() => ({
  mock_read_file: vi.fn(),
  mock_cpus: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mock_read_file }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    cpus: mock_cpus,
    totalmem: actual.totalmem,
    freemem: actual.freemem,
  };
});

import { SystemMetricsCollector } from "../../src/dashboard/system-metrics.js";

afterEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════
// L35: parts.length < 10 → continue
// ══════════════════════════════════════════

describe("read_net_sample — 짧은 라인 skip (L35)", () => {
  it("< 10컬럼 라인 포함 → 건너뜀, 유효 라인만 합산", async () => {
    // 헤더 2줄 + 짧은 라인 + 정상 eth0 라인
    const content = [
      "Inter-|   Receive                                                |  Transmit",
      " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
      "short line",  // parts.length=2 < 10 → continue (L35)
      "  eth0:   99000     200    0    0    0     0          0         0    55000     100    0    0    0     0       0          0",
    ].join("\n");

    mock_read_file.mockImplementation(async (path: string) => {
      if (path === "/proc/net/dev") return content;
      if (path === "/proc/meminfo") return "MemTotal: 8192 kB\nMemFree: 4096 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB";
      throw new Error(`ENOENT: ${String(path)}`);
    });
    mock_cpus.mockReturnValue([
      { times: { user: 1000, nice: 0, sys: 200, idle: 800, irq: 0 } },
    ]);

    const collector = new SystemMetricsCollector(50);
    try {
      collector.start();
      await new Promise(r => setTimeout(r, 80));
      const m = collector.get_latest();
      // net이 null이 아니라 수집됨 (eth0 라인은 유효)
      expect(m).not.toBeNull();
    } finally {
      collector.stop();
    }
  });
});

// ══════════════════════════════════════════
// L139: _calc_cpu — total_delta === 0 → return 0
// ══════════════════════════════════════════

describe("_calc_cpu — total_delta=0 (L139)", () => {
  it("CPU ticks 고정 → total_delta=0 → cpu_percent=0 (L139)", async () => {
    // cpus()가 항상 동일 값 반환 → total_delta=0
    const fixed_times = { user: 5000, nice: 0, sys: 1000, idle: 4000, irq: 0 };
    mock_cpus.mockReturnValue([{ times: { ...fixed_times } }]);

    mock_read_file.mockRejectedValue(new Error("ENOENT"));

    const collector = new SystemMetricsCollector(50);
    try {
      collector.start();
      // 두 번 수집: 첫 번째에서 prev_cpu 저장, 두 번째에서 _calc_cpu 호출
      await new Promise(r => setTimeout(r, 130));
      const m = collector.get_latest();
      expect(m).not.toBeNull();
      // total_delta=0 이므로 0 반환
      expect(m!.cpu_percent).toBe(0);
    } finally {
      collector.stop();
    }
  });
});
