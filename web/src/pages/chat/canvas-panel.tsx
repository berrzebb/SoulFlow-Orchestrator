/** Canvas 패널 — 에이전트가 생성한 인터랙티브 UI 컴포넌트 렌더러. */

import { useState } from "react";
import { useT } from "../../i18n";
import type {
  CanvasSpec,
  CanvasComponent,
  CanvasTextComponent,
  CanvasMetricComponent,
  CanvasChartComponent,
  CanvasTableComponent,
  CanvasImageComponent,
  CanvasFormComponent,
  CanvasButtonComponent,
  CanvasFormField,
} from "../../../../src/dashboard/canvas.types";

interface CanvasPanelProps {
  specs: CanvasSpec[];
  onAction: (action_id: string, data: Record<string, string>) => void;
  onDismiss: (canvas_id: string) => void;
}

export function CanvasPanel({ specs, onAction, onDismiss }: CanvasPanelProps) {
  if (specs.length === 0) return null;
  return (
    <div className="canvas-dock">
      {specs.map((spec) => (
        <CanvasCard key={spec.canvas_id} spec={spec} onAction={onAction} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function CanvasCard({ spec, onAction, onDismiss }: { spec: CanvasSpec; onAction: CanvasPanelProps["onAction"]; onDismiss: CanvasPanelProps["onDismiss"] }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="canvas-card">
      <div className="canvas-card__header">
        <button className="canvas-card__toggle" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? t("common.expand") : t("common.collapse")}>
          {collapsed ? "▶" : "▼"}
        </button>
        {spec.title && <span className="canvas-card__title">{spec.title}</span>}
        <button className="canvas-card__close" onClick={() => onDismiss(spec.canvas_id)} aria-label={t("common.dismiss")}>✕</button>
      </div>
      {!collapsed && (
        <div className="canvas-card__body">
          {spec.components.map((c, i) => (
            <CanvasComponentView key={i} component={c} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function CanvasComponentView({ component, onAction }: { component: CanvasComponent; onAction: CanvasPanelProps["onAction"] }) {
  switch (component.type) {
    case "text": return <CanvasText component={component} />;
    case "metric": return <CanvasMetric component={component} />;
    case "chart": return <CanvasChart component={component} />;
    case "table": return <CanvasTable component={component} />;
    case "image": return <CanvasImage component={component} />;
    case "form": return <CanvasForm component={component} onAction={onAction} />;
    case "button": return <CanvasButton component={component} onAction={onAction} />;
    case "divider": return <hr className="canvas-divider" />;
  }
}

// ── Text ──────────────────────────────────────────────────────────────────────

function CanvasText({ component }: { component: CanvasTextComponent }) {
  const { content, variant = "default", heading } = component;
  if (heading) {
    const Tag = `h${heading}` as "h1" | "h2" | "h3";
    return <Tag className={`canvas-text canvas-text--heading canvas-text--h${heading}`}>{content}</Tag>;
  }
  return <p className={`canvas-text canvas-text--${variant}`}>{content}</p>;
}

// ── Metric ────────────────────────────────────────────────────────────────────

function CanvasMetric({ component }: { component: CanvasMetricComponent }) {
  const { label, value, unit, trend, trend_up } = component;
  const trend_cls = trend_up === true ? "canvas-metric__trend--up" : trend_up === false ? "canvas-metric__trend--down" : "";
  const trend_icon = trend_up === true ? "↑" : trend_up === false ? "↓" : "";
  return (
    <div className="canvas-metric">
      <div className="canvas-metric__value">
        {value}
        {unit && <span className="canvas-metric__unit"> {unit}</span>}
      </div>
      <div className="canvas-metric__label">{label}</div>
      {trend && <div className={`canvas-metric__trend ${trend_cls}`}>{trend_icon}{trend}</div>}
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#ef4444", "#a855f7", "#f43f5e"];

function format_chart_num(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

function CanvasChart({ component }: { component: CanvasChartComponent }) {
  return (
    <div className="canvas-chart">
      {component.title && <div className="canvas-chart__title">{component.title}</div>}
      {component.kind === "bar" && <SvgBarChart component={component} />}
      {component.kind === "line" && <SvgLineChart component={component} />}
      {component.kind === "pie" && <SvgPieChart component={component} />}
      {component.datasets.length > 1 && (
        <div className="canvas-chart__legend">
          {component.datasets.map((ds, i) => (
            <span key={i} className="canvas-chart__legend-item">
              <span className="canvas-chart__legend-dot" style={{ background: ds.color || CHART_COLORS[i % CHART_COLORS.length] }} />
              {ds.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SvgBarChart({ component }: { component: CanvasChartComponent }) {
  const { labels, datasets } = component;
  if (!labels.length || !datasets.length) return null;
  const vw = 300, vh = 160, pad = { l: 38, r: 8, t: 14, b: 30 };
  const ba_w = vw - pad.l - pad.r;
  const ba_h = vh - pad.t - pad.b;
  const ba_x = pad.l, ba_y = pad.t;
  const n_ds = datasets.length;
  const group_w = ba_w / labels.length;
  const bar_gap = 2;
  const bar_w = Math.max(2, (group_w - bar_gap * (n_ds + 1)) / n_ds);
  const max_val = datasets.reduce((m, d) => d.data.reduce((mi, v) => Math.max(mi, Number(v) || 0), m), 1);

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} className="canvas-chart__svg">
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = ba_y + frac * ba_h;
        const val = max_val * (1 - frac);
        return (
          <g key={frac}>
            <line x1={ba_x} y1={y} x2={ba_x + ba_w} y2={y} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="3,3" />
            <text x={ba_x - 3} y={y + 4} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity="0.6">{format_chart_num(val)}</text>
          </g>
        );
      })}
      {labels.map((_, li) => {
        const gx = ba_x + li * group_w;
        return datasets.map((ds, di) => {
          const val = Number(ds.data[li] ?? 0);
          const bh = (val / max_val) * ba_h;
          const bx = gx + bar_gap + di * (bar_w + bar_gap);
          const by = ba_y + ba_h - bh;
          const color = ds.color || CHART_COLORS[di % CHART_COLORS.length];
          return (
            <rect key={`${li}-${di}`} x={bx} y={by} width={bar_w} height={bh} fill={color} rx="1.5" opacity="0.9">
              <title>{ds.label}: {val}</title>
            </rect>
          );
        });
      })}
      {labels.map((label, li) => {
        const gx = ba_x + li * group_w + group_w / 2;
        return (
          <text key={li} x={gx} y={ba_y + ba_h + 12} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.7">
            {label.length > 8 ? `${label.slice(0, 7)}…` : label}
          </text>
        );
      })}
      <line x1={ba_x} y1={ba_y} x2={ba_x} y2={ba_y + ba_h} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      <line x1={ba_x} y1={ba_y + ba_h} x2={ba_x + ba_w} y2={ba_y + ba_h} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
    </svg>
  );
}

function SvgLineChart({ component }: { component: CanvasChartComponent }) {
  const { labels, datasets } = component;
  if (!labels.length || !datasets.length) return null;
  const vw = 300, vh = 160, pad = { l: 38, r: 8, t: 14, b: 30 };
  const ba_w = vw - pad.l - pad.r;
  const ba_h = vh - pad.t - pad.b;
  const ba_x = pad.l, ba_y = pad.t;
  const max_val = datasets.reduce((m, d) => d.data.reduce((mi, v) => Math.max(mi, Number(v) || 0), m), 1);
  const pt_x = (li: number) => ba_x + (li / Math.max(labels.length - 1, 1)) * ba_w;
  const pt_y = (val: number) => ba_y + ba_h - (val / max_val) * ba_h;

  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} className="canvas-chart__svg">
      {[0.25, 0.5, 0.75].map((frac) => (
        <line key={frac} x1={ba_x} y1={ba_y + frac * ba_h} x2={ba_x + ba_w} y2={ba_y + frac * ba_h}
          stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="3,3" />
      ))}
      {datasets.map((ds, di) => {
        const color = ds.color || CHART_COLORS[di % CHART_COLORS.length];
        const pts = labels.map((_, li) => `${pt_x(li)},${pt_y(Number(ds.data[li] ?? 0))}`).join(" ");
        return (
          <g key={di}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
            {labels.map((_, li) => (
              <circle key={li} cx={pt_x(li)} cy={pt_y(Number(ds.data[li] ?? 0))} r="3" fill={color} opacity="0.9">
                <title>{ds.label}: {ds.data[li]}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {labels.map((label, li) => (
        <text key={li} x={pt_x(li)} y={ba_y + ba_h + 12} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.7">
          {label.length > 8 ? `${label.slice(0, 7)}…` : label}
        </text>
      ))}
      <line x1={ba_x} y1={ba_y} x2={ba_x} y2={ba_y + ba_h} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      <line x1={ba_x} y1={ba_y + ba_h} x2={ba_x + ba_w} y2={ba_y + ba_h} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
    </svg>
  );
}

function SvgPieChart({ component }: { component: CanvasChartComponent }) {
  const { labels, datasets } = component;
  if (!labels.length || !datasets.length) return null;
  const ds = datasets[0]!;
  const values = labels.map((_, i) => Math.max(0, Number(ds.data[i] ?? 0)));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = 75, cy = 75, r = 60, ir = 28;
  let angle = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const frac = v / total;
    const a0 = angle;
    angle += frac * Math.PI * 2;
    const a1 = angle;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0);
    const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
    const ix1 = cx + ir * Math.cos(a0), iy1 = cy + ir * Math.sin(a0);
    const ix2 = cx + ir * Math.cos(a1), iy2 = cy + ir * Math.sin(a1);
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z`;
    return { d, color: CHART_COLORS[i % CHART_COLORS.length], label: labels[i] ?? "", frac, val: v };
  });

  return (
    <svg viewBox="0 0 280 160" className="canvas-chart__svg">
      {slices.map((s, i) => (
        <path key={i} d={s.d} fill={s.color} opacity="0.9">
          <title>{s.label}: {s.val} ({(s.frac * 100).toFixed(1)}%)</title>
        </path>
      ))}
      {labels.slice(0, 7).map((label, i) => (
        <g key={i} transform={`translate(168, ${16 + i * 20})`}>
          <rect width="10" height="10" rx="2" fill={CHART_COLORS[i % CHART_COLORS.length]} />
          <text x="14" y="9" fontSize="9" fill="currentColor" fillOpacity="0.8">
            {label.length > 13 ? `${label.slice(0, 12)}…` : label} ({(values[i]! / total * 100).toFixed(0)}%)
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

function CanvasTable({ component }: { component: CanvasTableComponent }) {
  return (
    <div className="canvas-table-wrap">
      {component.title && <div className="canvas-table__title">{component.title}</div>}
      <table className="canvas-table">
        <thead>
          <tr>{component.columns.map((col, i) => <th key={i}>{col}</th>)}</tr>
        </thead>
        <tbody>
          {component.rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Image ─────────────────────────────────────────────────────────────────────

function CanvasImage({ component }: { component: CanvasImageComponent }) {
  return (
    <figure className="canvas-image">
      <img src={component.url} alt={component.alt || ""} className="canvas-image__img" />
      {component.caption && <figcaption className="canvas-image__caption">{component.caption}</figcaption>}
    </figure>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

function CanvasForm({ component, onAction }: { component: CanvasFormComponent; onAction: CanvasPanelProps["onAction"] }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of component.fields) {
      init[f.id] = f.default ?? (f.type === "checkbox" ? "false" : "");
    }
    return init;
  });
  const [submitted, setSubmitted] = useState(false);

  const handle_submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    onAction(component.action_id || "form_submit", values);
  };

  return (
    <form className="canvas-form" onSubmit={handle_submit}>
      {component.title && <div className="canvas-form__title">{component.title}</div>}
      {component.fields.map((f) => (
        <FormField key={f.id} field={f} value={values[f.id] ?? ""} onChange={(v) => setValues((p) => ({ ...p, [f.id]: v }))} />
      ))}
      <button type="submit" className="canvas-form__submit" disabled={submitted}>
        {submitted ? t("common.submitted") : (component.submit_label || t("common.submit"))}
      </button>
    </form>
  );
}

function FormField({ field, value, onChange }: { field: CanvasFormField; value: string; onChange: (v: string) => void }) {
  return (
    <div className="canvas-form__field">
      <label className="canvas-form__label" htmlFor={`cf-${field.id}`}>
        {field.label}
        {field.required && <span className="canvas-form__required"> *</span>}
      </label>
      {field.type === "select" ? (
        <select id={`cf-${field.id}`} className="canvas-form__input" value={value} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">{t("common.select")}</option>
          {(field.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : field.type === "checkbox" ? (
        <input id={`cf-${field.id}`} type="checkbox" className="canvas-form__checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
      ) : (
        <input id={`cf-${field.id}`} type={field.type} className="canvas-form__input" value={value} onChange={(e) => onChange(e.target.value)} required={field.required} />
      )}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

function CanvasButton({ component, onAction }: { component: CanvasButtonComponent; onAction: CanvasPanelProps["onAction"] }) {
  const [clicked, setClicked] = useState(false);
  return (
    <button
      className={`canvas-button canvas-button--${component.variant || "primary"}`}
      disabled={clicked}
      onClick={() => { setClicked(true); onAction(component.action_id || "button_click", {}); }}
    >
      {component.label}
    </button>
  );
}
