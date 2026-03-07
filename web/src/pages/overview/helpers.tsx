export function fmt_uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmt_kbps(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${kbps} KB/s`;
}

export function MetricBar({ label, percent, used, total, unit = "MB", color = "var(--accent)" }: {
  label: string; percent: number; used: number; total: number; unit?: string; color?: string;
}) {
  const vars = { "--bar-w": `${Math.min(percent, 100)}%`, "--bar-c": color } as React.CSSProperties;
  return (
    <div className="metric-bar" style={vars}>
      <div className="metric-bar__header">
        <span className="text-muted">{label}</span>
        <span className="fw-600">{used.toLocaleString()} / {total.toLocaleString()} {unit} <span className="text-muted">({percent}%)</span></span>
      </div>
      <div className="metric-bar__track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="metric-bar__fill" />
      </div>
    </div>
  );
}

export function ModeBadge({ mode }: { mode: string }) {
  return (
    <span className={`mode-badge mode-badge--${mode}`}>
      {mode.toUpperCase()}
    </span>
  );
}

export function PulseDot({ active }: { active: boolean }) {
  if (!active) return null;
  return <span className="pulse-dot" />;
}

export function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`status-dot ${ok ? "status-dot--ok status-dot--pulse" : "status-dot--err"}`} />;
}
