import { cpus, totalmem, freemem } from "node:os";
import { readFile } from "node:fs/promises";

export interface SystemMetrics {
  cpu_percent: number;          // 0~100
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;          // 0~100
  swap_total_mb: number | null; // Linux only
  swap_used_mb: number | null;
  swap_percent: number | null;
  net_rx_kbps: number | null;   // KB/s (Linux only)
  net_tx_kbps: number | null;
  uptime_s: number;
}

type CpuTick = { idle: number; total: number };

function cpu_ticks(): CpuTick {
  const cores = cpus();
  const idle = cores.reduce((s, c) => s + c.times.idle, 0);
  const total = cores.reduce((s, c) => s + Object.values(c.times).reduce((a, b) => a + b, 0), 0);
  return { idle, total };
}

type NetSample = { rx: number; tx: number; at: number };

async function read_net_sample(): Promise<NetSample | null> {
  try {
    const raw = await readFile("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const line of raw.split("\n").slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(":", "");
      if (iface === "lo") continue;
      rx += parseInt(parts[1], 10) || 0;
      tx += parseInt(parts[9], 10) || 0;
    }
    return { rx, tx, at: Date.now() };
  } catch {
    return null;
  }
}

async function read_swap(): Promise<{ total_mb: number; used_mb: number } | null> {
  try {
    const raw = await readFile("/proc/meminfo", "utf8");
    let swap_total = 0;
    let swap_free = 0;
    for (const line of raw.split("\n")) {
      const [key, val] = line.split(":");
      const kb = parseInt(val?.trim() ?? "0", 10);
      if (key === "SwapTotal") swap_total = kb;
      if (key === "SwapFree") swap_free = kb;
    }
    return { total_mb: Math.round(swap_total / 1024), used_mb: Math.round((swap_total - swap_free) / 1024) };
  } catch {
    return null;
  }
}

/** CPU/Memory/Swap/네트워크를 주기적으로 샘플링하여 최신 메트릭 제공 */
export class SystemMetricsCollector {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _prev_cpu: CpuTick | null = null;
  private _prev_net: NetSample | null = null;
  private _latest: SystemMetrics | null = null;
  private readonly _interval_ms: number;

  constructor(interval_ms = 3000) {
    this._interval_ms = interval_ms;
  }

  start(): void {
    if (this._timer) return;
    void this._collect(); // 즉시 첫 샘플
    this._timer = setInterval(() => void this._collect(), this._interval_ms);
    if (this._timer.unref) this._timer.unref(); // Node.js 프로세스 종료 방해하지 않음
  }

  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  get_latest(): SystemMetrics | null {
    return this._latest;
  }

  private async _collect(): Promise<void> {
    const cur_cpu = cpu_ticks();
    const cpu_percent = this._prev_cpu
      ? this._calc_cpu(this._prev_cpu, cur_cpu)
      : 0;
    this._prev_cpu = cur_cpu;

    const total = totalmem();
    const free = freemem();
    const mem_total_mb = Math.round(total / (1024 * 1024));
    const mem_used_mb = Math.round((total - free) / (1024 * 1024));

    const swap = await read_swap();
    const net_now = await read_net_sample();

    let net_rx_kbps: number | null = null;
    let net_tx_kbps: number | null = null;
    if (net_now && this._prev_net) {
      const dt_s = (net_now.at - this._prev_net.at) / 1000;
      if (dt_s > 0) {
        net_rx_kbps = Math.round(((net_now.rx - this._prev_net.rx) / 1024) / dt_s);
        net_tx_kbps = Math.round(((net_now.tx - this._prev_net.tx) / 1024) / dt_s);
      }
    }
    this._prev_net = net_now;

    this._latest = {
      cpu_percent: Math.round(cpu_percent),
      mem_total_mb,
      mem_used_mb,
      mem_percent: mem_total_mb > 0 ? Math.round((mem_used_mb / mem_total_mb) * 100) : 0,
      swap_total_mb: swap?.total_mb ?? null,
      swap_used_mb: swap?.used_mb ?? null,
      swap_percent: swap && swap.total_mb > 0
        ? Math.round((swap.used_mb / swap.total_mb) * 100)
        : null,
      net_rx_kbps: net_rx_kbps !== null && net_rx_kbps >= 0 ? net_rx_kbps : null,
      net_tx_kbps: net_tx_kbps !== null && net_tx_kbps >= 0 ? net_tx_kbps : null,
      uptime_s: Math.floor(process.uptime()),
    };
  }

  private _calc_cpu(prev: CpuTick, cur: CpuTick): number {
    const idle_delta = cur.idle - prev.idle;
    const total_delta = cur.total - prev.total;
    if (total_delta === 0) return 0;
    return ((total_delta - idle_delta) / total_delta) * 100;
  }
}
