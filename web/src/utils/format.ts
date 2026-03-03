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
