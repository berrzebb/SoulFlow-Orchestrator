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

const rtf_cache = new Map<string, Intl.RelativeTimeFormat>();
function get_rtf(locale: string): Intl.RelativeTimeFormat {
  let rtf = rtf_cache.get(locale);
  if (!rtf) { rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }); rtf_cache.set(locale, rtf); }
  return rtf;
}

/** 상대 시간 표시 — Intl.RelativeTimeFormat 기반 로케일 자동 대응. */
export function time_ago(date: string | number | Date, locale?: string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  const rtf = get_rtf(locale ?? navigator.language);

  if (sec < 60) return rtf.format(-sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.floor(hr / 24);
  return rtf.format(-day, "day");
}
