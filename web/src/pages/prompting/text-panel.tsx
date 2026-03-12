/**
 * Prompting — Text 탭.
 * {{variable}} 문법으로 템플릿 변수를 오른쪽 패널에서 채워 넣을 수 있다.
 */
import { useState, useMemo } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n";
import { StudioModelPicker, type StudioModelValue } from "../../components/studio-model-picker";
import { RunResult, type RunResultValue } from "./run-result";

type TemplateTab = "write" | "preview";

/** 프롬프트 템플릿에서 {{varName}} 변수명 추출 */
function extract_vars(template: string): string[] {
  const matches = [...template.matchAll(/\{\{(\w+)\}\}/g)];
  const seen = new Set<string>();
  return matches.flatMap((m) => {
    const v = m[1];
    if (!v || seen.has(v)) return [];
    seen.add(v);
    return [v];
  });
}

function apply_vars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function TextPanel() {
  const t = useT();
  const [model, setModel] = useState<StudioModelValue>({ provider_id: "", model: "" });
  const [system, setSystem] = useState("");
  const [template, setTemplate] = useState("{{prompt}}");
  const [template_tab, setTemplateTab] = useState<TemplateTab>("write");
  const [temperature, setTemperature] = useState(0.7);
  const [max_tokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResultValue | null>(null);

  const var_names = useMemo(() => extract_vars(template), [template]);
  const rendered_prompt = apply_vars(template, vars);
  const temp_label = temperature <= 0.3 ? t("prompting.temp_precise") : temperature <= 0.7 ? t("prompting.temp_balance") : t("prompting.temp_creative");

  const handle_run = async () => {
    if (!model.provider_id) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await api.post<RunResultValue>("/api/prompt/run", {
        provider_id: model.provider_id,
        model: model.model || undefined,
        prompt: rendered_prompt,
        system: system.trim() || undefined,
        temperature,
        max_tokens,
      });
      setResult(res);
    } catch (err) {
      setResult({ content: null, finish_reason: "error", latency_ms: 0, usage: {}, model: "", provider_id: model.provider_id, error: String((err as Error)?.message || err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ps-split">
      {/* ── 왼쪽: 설정 ── */}
      <aside className="ps-config">
        {/* 타이틀 */}
        <div className="ps-pane-head">
          <div className="ps-pane-head__icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </div>
          <span className="ps-pane-head__title">{t("prompting.text_title")}</span>
        </div>

        {/* 모델 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.model")}</span>
          <StudioModelPicker value={model} onChange={setModel} />
        </div>

        {/* 파라미터 */}
        <div className="ps-pane-sec">
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">{t("prompting.temperature")} <span style={{ fontWeight: 400, opacity: 0.6 }}>({temp_label})</span></span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                style={{ width: 96 }}
                min={0} max={2} step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
              <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 28, textAlign: "right" }}>{temperature}</span>
            </div>
          </div>
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">{t("prompting.max_tokens")}</span>
            <input
              className="input input--sm"
              style={{ width: 88, textAlign: "right" }}
              type="number"
              min={1}
              placeholder="default"
              value={max_tokens ?? ""}
              onChange={(e) => setMaxTokens(e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        </div>

        {/* 시스템 프롬프트 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">
            {t("prompting.system_prompt")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("prompting.optional")}</span>
          </span>
          <textarea
            className="ps-prompt-area"
            style={{ minHeight: 72 }}
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder={t("prompting.system_prompt_ph")}
          />
        </div>

        {/* 프롬프트 템플릿 */}
        <div className="ps-pane-sec ps-pane-sec--grow ps-pane-sec--noborder">
          <div className="ps-template-header">
            <span className="ps-pane-sec__label ps-pane-sec__label--with-info">
              {t("prompting.prompt_template")}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="ps-template-tabs">
                <button className={`ps-template-tab${template_tab === "write" ? " ps-template-tab--active" : ""}`} onClick={() => setTemplateTab("write")}>{t("prompting.write")}</button>
                <button className={`ps-template-tab${template_tab === "preview" ? " ps-template-tab--active" : ""}`} onClick={() => setTemplateTab("preview")}>{t("prompting.preview")}</button>
              </div>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{"{{var}}"}</span>
            </div>
          </div>

          {template_tab === "write" ? (
            <textarea
              className="ps-prompt-area ps-prompt-area--grow ps-prompt-area--code"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="{{prompt}}"
              spellCheck={false}
            />
          ) : (
            <div className="ps-prompt-preview">
              {rendered_prompt || <span style={{ color: "var(--off)" }}>{t("prompting.preview_hint")}</span>}
            </div>
          )}
        </div>
      </aside>

      {/* ── 오른쪽: 입력 + 결과 ── */}
      <main className="ps-preview">
        {/* Input 헤더 */}
        <div className="ps-preview-head">
          <div className="ps-preview-head__top">
            <span className="ps-preview-head__icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </span>
            <span className="ps-preview-head__title">{t("prompting.input")}</span>
          </div>
          <div className="ps-preview-head__sub">
            {var_names.length > 0
              ? t("prompting.vars_hint", { count: String(var_names.length) })
              : t("prompting.vars_empty")
            }
          </div>
        </div>

        {/* 변수 입력 */}
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--line)" }}>
          {var_names.length === 0 ? (
            <div style={{ padding: "8px 0", fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
              {t("prompting.no_vars", { example: "{{variable}}" })}
            </div>
          ) : (
            var_names.map((v) => (
              <div key={v} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{v}</span>
                <textarea
                  className="ps-prompt-area"
                  style={{ minHeight: 56 }}
                  value={vars[v] ?? ""}
                  onChange={(e) => setVars((prev) => ({ ...prev, [v]: e.target.value }))}
                  placeholder={t("prompting.var_placeholder", { name: v })}
                />
              </div>
            ))
          )}
        </div>

        {/* Run 바 */}
        <div className="ps-run-bar-header" style={{ borderBottom: "1px solid var(--line)" }}>
          <button
            className={`ps-run-btn-main${running ? " ps-run-btn-main--running" : ""}`}
            style={{ flex: 1 }}
            disabled={running || !model.provider_id}
            onClick={() => void handle_run()}
          >
            {running
              ? <>⏳ {t("prompting.running")}</>
              : <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t("prompting.run")}
                  <span className="ps-shortcut">⌘↵</span>
                </>
            }
          </button>
        </div>

        {/* Preview 헤더 */}
        <div className="ps-preview-head" style={{ borderTop: "none" }}>
          <div className="ps-preview-head__top">
            <span className="ps-preview-head__icon">✦</span>
            <span className="ps-preview-head__title">{t("prompting.output")}</span>
          </div>
          <div className="ps-preview-head__sub">{t("prompting.output_hint")}</div>
        </div>

        {/* 결과 */}
        <div className="ps-output-area">
          <RunResult value={result} loading={running} />
        </div>
      </main>
    </div>
  );
}
