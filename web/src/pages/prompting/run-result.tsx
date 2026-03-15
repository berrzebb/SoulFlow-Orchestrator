/** Prompt Studio 공통 실행 결과 표시 컴포넌트. */
import { useState } from "react";

export type RunResultValue = {
  content: string | null;
  finish_reason: string;
  latency_ms: number;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost_usd?: number };
  model: string;
  provider_id: string;
  error?: string;
  /** FE-3: 평가 루브릭 점수 0–1 (F1+F2 Acceptance Rubric 결과). */
  eval_score?: number;
};

export function RunResult({ value, loading }: { value: RunResultValue | null; loading?: boolean }) {
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <section className="ps-result ps-result--loading">
        <div className="ps-result__skeleton" />
        <div className="ps-result__skeleton ps-result__skeleton--sm" />
        <div className="ps-result__skeleton ps-result__skeleton--sm" style={{ width: "65%" }} />
      </section>
    );
  }
  if (!value) {
    return (
      <section className="ps-result ps-result--empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2 }}>
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span className="ps-hint" style={{ marginTop: 6 }}>Run 버튼을 눌러 실행하세요.</span>
      </section>
    );
  }
  if (value.error || value.finish_reason === "error") {
    return (
      <section className="ps-result ps-result--err">
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--err)", flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--err)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Error</span>
        </div>
        <p className="ps-result__err-msg">{value.error ?? value.content}</p>
      </section>
    );
  }

  const { content, finish_reason, latency_ms, usage, model, provider_id, eval_score } = value;
  const cost_usd = usage.cost_usd;

  const handle_copy = () => {
    void navigator.clipboard.writeText(content ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className="ps-result">
      <div className="ps-result__meta">
        <span className="ps-chip ps-chip--model">{provider_id}{model ? ` · ${model}` : ""}</span>
        <span className="ps-chip">{(latency_ms / 1000).toFixed(2)}s</span>
        {usage.total_tokens != null && <span className="ps-chip">{usage.total_tokens} tok</span>}
        {cost_usd != null && cost_usd > 0 && <span className="ps-chip">${cost_usd.toFixed(4)}</span>}
        {finish_reason !== "stop" && <span className="ps-chip ps-chip--warn">{finish_reason}</span>}
        {/* FE-3: 평가 루브릭 점수 배지 */}
        {eval_score != null && (
          <span
            className={`ps-chip ps-chip--score${eval_score >= 0.8 ? " ps-chip--score-ok" : eval_score >= 0.5 ? " ps-chip--score-warn" : " ps-chip--score-err"}`}
            title={`Eval score: ${(eval_score * 100).toFixed(0)}%`}
          >
            {(eval_score * 100).toFixed(0)}%
          </span>
        )}
        <button
          className="ps-result__copy"
          onClick={handle_copy}
          title="Copy to clipboard"
          aria-label="Copy output"
        >
          {copied
            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          }
        </button>
      </div>
      <pre className="ps-result__content">{content ?? "(empty)"}</pre>
    </section>
  );
}
