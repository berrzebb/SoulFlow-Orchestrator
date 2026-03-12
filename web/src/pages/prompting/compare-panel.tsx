/**
 * Prompting — Compare 탭.
 * 동일한 프롬프트를 여러 모델에 동시 실행하여 결과·비용·레이턴시를 나란히 비교.
 */
import { useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { StudioModelPicker, type StudioModelValue } from "../../components/studio-model-picker";
import { RunResult, type RunResultValue } from "./run-result";

const EMPTY_TARGET = (): StudioModelValue => ({ provider_id: "", model: "" });

type CompareResult = (RunResultValue & { ok: boolean; error?: string }) | null;

export function ComparePanel() {
  const t = useT();
  const { toast } = useToast();
  const [targets, setTargets] = useState<StudioModelValue[]>([EMPTY_TARGET(), EMPTY_TARGET()]);
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [max_tokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CompareResult[]>([]);

  const add_target = () => setTargets((t) => [...t, EMPTY_TARGET()]);
  const remove_target = (i: number) => setTargets((t) => t.filter((_, idx) => idx !== i));
  const update_target = (i: number, v: StudioModelValue) =>
    setTargets((t) => t.map((x, idx) => (idx === i ? v : x)));

  const handle_run = async () => {
    if (!prompt.trim()) return;
    const active = targets.filter((t) => t.provider_id);
    if (!active.length) return;
    setRunning(true);
    setResults([]);
    try {
      const res = await api.post<CompareResult[]>("/api/prompt/compare", {
        prompt,
        system: system.trim() || undefined,
        temperature,
        max_tokens,
        targets: active,
      });
      setResults(res);
    } catch {
      toast(t("prompting.compare_failed"), "err");
      setResults(active.map(() => null));
    } finally {
      setRunning(false);
    }
  };

  const temp_label = temperature <= 0.3 ? t("prompting.temp_precise") : temperature <= 0.7 ? t("prompting.temp_balance") : t("prompting.temp_creative");
  const active_count = targets.filter((t) => t.provider_id).length;

  return (
    <div className="ps-split">
      {/* ── 왼쪽: 공통 설정 ── */}
      <aside className="ps-config">
        <div className="ps-pane-head">
          <div className="ps-pane-head__icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <span className="ps-pane-head__title">{t("prompting.compare_title")}</span>
        </div>

        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">Parameters</span>
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">
              Temperature <span style={{ fontWeight: 400, opacity: 0.65 }}>({temp_label})</span>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="range" style={{ width: 88 }} min={0} max={2} step={0.1}
                value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
              <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 26, textAlign: "right" }}>{temperature}</span>
            </div>
          </div>
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">Max Tokens</span>
            <input className="input input--sm" style={{ width: 88, textAlign: "right" }}
              type="number" min={1} placeholder="default" value={max_tokens ?? ""}
              onChange={(e) => setMaxTokens(e.target.value ? Number(e.target.value) : undefined)} />
          </div>
        </div>

        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">
            System Prompt <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
          </span>
          <textarea className="ps-prompt-area" style={{ minHeight: 64 }}
            value={system} onChange={(e) => setSystem(e.target.value)}
            placeholder="You are a helpful assistant." />
        </div>

        <div className="ps-pane-sec ps-pane-sec--grow ps-pane-sec--noborder">
          <span className="ps-pane-sec__label">Prompt</span>
          <textarea className="ps-prompt-area ps-prompt-area--grow"
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="비교할 프롬프트를 입력하세요…" />
          <button
            className={`ps-run-btn-main${running ? " ps-run-btn-main--running" : ""}`}
            style={{ marginTop: 4 }}
            disabled={running || !prompt.trim() || !active_count}
            onClick={() => void handle_run()}
          >
            {running
              ? <>⏳ Running…</>
              : <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Compare
                  <span className="ps-shortcut">⌘↵</span>
                </>
            }
          </button>
        </div>
      </aside>

      {/* ── 오른쪽: 모델 선택 + 결과 ── */}
      <main className="ps-preview" style={{ display: "flex", flexDirection: "column" }}>
        {/* 모델 헤더 */}
        <div className="ps-preview-head">
          <div className="ps-preview-head__top">
            <span className="ps-preview-head__icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            </span>
            <span className="ps-preview-head__title">Models</span>
          </div>
          <div className="ps-preview-head__sub">최대 6개 모델까지 동시 비교.</div>
        </div>

        {/* 모델 선택 목록 */}
        <div className="ps-compare__model-list">
          {targets.map((t, i) => (
            <div key={i} className="ps-compare__model-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <StudioModelPicker compact value={t} onChange={(v) => update_target(i, v)} />
              </div>
              {targets.length > 2 && (
                <button className="btn btn--xs btn--danger"
                  onClick={() => remove_target(i)} aria-label="Remove"
                  style={{ flexShrink: 0 }}>✕</button>
              )}
            </div>
          ))}
          {targets.length < 6 && (
            <button className="btn btn--xs" style={{ alignSelf: "flex-start" }} onClick={add_target}>
              + Add Model
            </button>
          )}
        </div>

        {/* 결과 영역 */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {!running && results.length === 0 ? (
            <div className="ps-preview-empty" style={{ minHeight: 180 }}>
              <div className="ps-preview-empty__icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              <span>프롬프트를 입력하고 Compare를 실행하세요.</span>
            </div>
          ) : (
            <div
              className="ps-compare__grid"
              style={{ "--col-count": String(Math.max(results.length, active_count)) } as React.CSSProperties}
            >
              {targets.filter((t) => t.provider_id).map((t, i) => (
                <div key={i} className="ps-compare__cell">
                  <div className="ps-compare__cell-header">
                    <span className="ps-chip">{t.provider_id}</span>
                    {t.model && <span className="ps-chip ps-chip--model">{t.model}</span>}
                  </div>
                  <RunResult value={results[i] ?? null} loading={running && !results[i]} />
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
