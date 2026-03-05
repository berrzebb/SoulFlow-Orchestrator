interface ScheduleLike {
  kind: string;
  every_ms?: number;
  expr?: string;
  at_ms?: number;
}

export function fmt_time(ms: number | string | undefined): string {
  if (!ms) return "-";
  return new Date(typeof ms === "number" ? ms : ms).toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace(" ", " ");
}

export function fmt_schedule(s: ScheduleLike | undefined): string {
  if (!s) return "-";
  if (s.kind === "every" && s.every_ms) {
    const ms = s.every_ms;
    if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
    return `every ${(ms / 3_600_000).toFixed(1)}h`;
  }
  if (s.kind === "cron") return `cron: ${s.expr ?? ""}`;
  if (s.kind === "at") return `at ${fmt_time(s.at_ms)}`;
  return s.kind;
}

/** 상대 시간 표시 (e.g., "3분 전", "2 hours ago"). */
export function time_ago(date: string | number | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
