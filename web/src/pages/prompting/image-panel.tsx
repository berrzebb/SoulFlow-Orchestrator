/**
 * Prompting — Image 탭.
 * 이미지 생성 모델을 선택하고 프롬프트를 실행, 결과 이미지를 그리드로 표시.
 *
 * Layout: 좌(설정) / 우(Input + Preview) — Google AI Studio Image Generation 패턴.
 */
import { useState } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n";
import { StudioModelPicker, type StudioModelValue } from "../../components/studio-model-picker";

const SIZES = ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"];
const RATIOS = ["Auto", "1:1", "4:3", "3:4", "16:9", "9:16"];
const COUNTS = [1, 2, 4];

interface GeneratedImage {
  url: string;
  revised_prompt?: string;
}

interface ImageResult {
  images: GeneratedImage[];
  elapsed_ms: number;
  cost_usd?: number;
  count: number;
  completed: number;
}

type TemplateTab = "write" | "preview";

/** {{var}} 치환 */
function apply_vars(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function ImagePanel() {
  const t = useT();
  const [model, setModel] = useState<StudioModelValue>({ provider_id: "", model: "" });
  const [size, setSize] = useState("1024x1024");
  const [ratio, setRatio] = useState("Auto");
  const [count, setCount] = useState(1);
  const [ref_url, setRefUrl] = useState("");
  const [template, setTemplate] = useState("");
  const [template_tab, setTemplateTab] = useState<TemplateTab>("write");
  const [vars] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rendered_prompt = apply_vars(template, vars);

  const handle_run = async () => {
    if (!model.provider_id || !template.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);
    const t0 = Date.now();
    try {
      const res = await api.post<ImageResult>("/api/prompt/image", {
        provider_id: model.provider_id,
        model: model.model || undefined,
        prompt: rendered_prompt,
        size,
        n: count,
        reference_url: ref_url.trim() || undefined,
      });
      setResult({ ...res, elapsed_ms: res.elapsed_ms ?? (Date.now() - t0) });
    } catch (err) {
      setError(String((err as Error)?.message || err));
    } finally {
      setRunning(false);
    }
  };

  const elapsed_s = result ? (result.elapsed_ms / 1000).toFixed(1) : null;

  return (
    <div className="ps-split">
      {/* ── 왼쪽: 설정 ── */}
      <aside className="ps-config">
        {/* 타이틀 */}
        <div className="ps-pane-head">
          <div className="ps-pane-head__icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
          <span className="ps-pane-head__title">{t("prompting.image_title")}</span>
        </div>

        {/* 모델 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.model")}</span>
          <StudioModelPicker value={model} onChange={setModel} purpose="image" />
        </div>

        {/* Size + Aspect Ratio */}
        <div className="ps-pane-sec">
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">{t("prompting.size")}</span>
            <select className="ps-select-sm" value={size} onChange={(e) => setSize(e.target.value)}>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">{t("prompting.aspect_ratio")}</span>
            <select className="ps-select-sm" value={ratio} onChange={(e) => setRatio(e.target.value)}>
              {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* 레퍼런스 이미지 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.ref_images")}</span>
          <span className="ps-pane-sec__desc">{t("prompting.ref_images_desc")}</span>
          <div className="ps-upload-row">
            <input
              className="ps-upload-input"
              placeholder={t("prompting.ref_image_ph")}
              value={ref_url}
              onChange={(e) => setRefUrl(e.target.value)}
            />
            <button className="ps-upload-btn">{t("prompting.upload")}</button>
          </div>
          <div
            className="ps-drop-zone"
            onDragOver={(e) => e.preventDefault()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            {t("prompting.drag_drop_images")}
          </div>
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
              <button className="ps-help-write">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                {t("prompting.help_write")}
              </button>
            </div>
          </div>

          {template_tab === "write" ? (
            <textarea
              className="ps-prompt-area ps-prompt-area--grow"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={t("prompting.image_prompt_ph")}
            />
          ) : (
            <div className="ps-prompt-preview">
              {rendered_prompt || <span style={{ color: "var(--off)" }}>{t("prompting.preview_hint")}</span>}
            </div>
          )}
        </div>
      </aside>

      {/* ── 오른쪽: Input + Preview ── */}
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
          <div className="ps-preview-head__sub">{t("prompting.image_input_hint")}</div>
        </div>

        {/* Run 바 */}
        <div className="ps-run-bar-header">
          <select
            className="ps-count-select"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            aria-label="Count"
            style={{ border: "1px solid var(--line)", borderRadius: 8, height: 36, padding: "0 8px", fontSize: 13, fontWeight: 500, color: "var(--text)", background: "transparent", cursor: "pointer" }}
          >
            {COUNTS.map((c) => <option key={c} value={c}>{c}x</option>)}
          </select>
          <button
            className={`ps-run-btn-main${running ? " ps-run-btn-main--running" : ""}`}
            disabled={running || !model.provider_id || !template.trim()}
            onClick={() => void handle_run()}
          >
            {running
              ? <>⏳ {t("prompting.generating")}</>
              : <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t("prompting.run")}
                  <span className="ps-shortcut">⌘↵</span>
                </>
            }
          </button>
        </div>

        {/* Preview 헤더 */}
        <div className="ps-preview-head" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="ps-preview-head__top">
            <span className="ps-preview-head__icon">✦</span>
            <span className="ps-preview-head__title">{t("prompting.output")}</span>
          </div>
          <div className="ps-preview-head__sub">{t("prompting.image_output_hint")}</div>
        </div>

        {/* 출력 영역 */}
        <div className="ps-output-area">
          {error && (
            <div style={{ padding: "10px 12px", background: "color-mix(in srgb, var(--err) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--err) 30%, transparent)", borderRadius: 8, fontSize: 13, color: "var(--err)" }}>
              {error}
            </div>
          )}

          {result && (
            <div className="ps-output-stats">
              <span>Elapsed: {elapsed_s}s</span>
              {result.cost_usd != null && (
                <span>Total Cost: ${result.cost_usd.toFixed(3)} ({result.completed}/{result.count} completed)</span>
              )}
            </div>
          )}

          {running ? (
            <div className={`ps-image-grid ps-image-grid--${count}x`}>
              {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="ps-image-cell--skeleton" />
              ))}
            </div>
          ) : result?.images.length ? (
            <div className={`ps-image-grid${count === 1 ? " ps-image-grid--1" : ""}`}>
              {result.images.map((img, i) => (
                <div key={i} className="ps-image-cell">
                  <img src={img.url} alt={img.revised_prompt || `Generated image ${i + 1}`} />
                  <div className="ps-image-cell__overlay">
                    <a
                      href={img.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn--xs"
                      style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }}
                    >
                      Open
                    </a>
                    <a
                      href={img.url}
                      download={`image-${i + 1}.png`}
                      className="btn btn--xs btn--accent"
                    >
                      Save
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : !running && !error && (
            <div className="ps-preview-empty">
              <div className="ps-preview-empty__icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <span>이미지가 여기에 표시됩니다.</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
