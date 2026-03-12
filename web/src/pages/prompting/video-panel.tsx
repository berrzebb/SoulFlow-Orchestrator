/**
 * Prompting — Video 탭.
 * 비디오 생성 모델 선택 + 프롬프트 실행 → Recent Videos 목록 표시.
 * Remix Video ID는 제외 (설계 단순화).
 */
import { useState } from "react";
import { api } from "../../api/client";
import { useT } from "../../i18n";
import { StudioModelPicker, type StudioModelValue } from "../../components/studio-model-picker";

const VIDEO_SIZES = ["1280x720", "1920x1080", "720x1280", "1080x1920", "512x512"];
const VIDEO_SECONDS = [4, 6, 8, 10, 16];

type VideoStatus = "pending" | "ok" | "err";

interface VideoItem {
  id: string;
  prompt: string;
  model: string;
  provider_id: string;
  size: string;
  seconds: number;
  status: VideoStatus;
  video_url?: string;
  thumbnail_url?: string;
  elapsed_ms?: number;
  cost_usd?: number;
  created_at: number;
  expanded: boolean;
}

interface VideoGenResponse {
  video_id?: string;
  video_url?: string;
  thumbnail_url?: string;
  elapsed_ms?: number;
  cost_usd?: number;
  status?: string;
}

function time_ago(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function VideoPanel() {
  const t = useT();
  const [model, setModel] = useState<StudioModelValue>({ provider_id: "", model: "" });
  const [size, setSize] = useState("1280x720");
  const [seconds, setSeconds] = useState(4);
  const [ref_url, setRefUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [videos, setVideos] = useState<VideoItem[]>([]);

  const handle_run = async () => {
    if (!model.provider_id || !prompt.trim()) return;
    const tmp_id = `vid_${Date.now()}`;

    // pending 항목 먼저 추가
    const pending_item: VideoItem = {
      id: tmp_id,
      prompt: prompt.trim(),
      model: model.model || "auto",
      provider_id: model.provider_id,
      size,
      seconds,
      status: "pending",
      created_at: Date.now(),
      expanded: true,
    };
    setVideos((prev) => [pending_item, ...prev]);
    setRunning(true);

    try {
      const res = await api.post<VideoGenResponse>("/api/prompt/video", {
        provider_id: model.provider_id,
        model: model.model || undefined,
        prompt: prompt.trim(),
        size,
        duration: seconds,
        reference_url: ref_url.trim() || undefined,
      });

      setVideos((prev) =>
        prev.map((v) =>
          v.id === tmp_id
            ? {
                ...v,
                id: res.video_id || tmp_id,
                status: "ok",
                video_url: res.video_url,
                thumbnail_url: res.thumbnail_url,
                elapsed_ms: res.elapsed_ms,
                cost_usd: res.cost_usd,
              }
            : v,
        ),
      );
    } catch (err) {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === tmp_id
            ? { ...v, status: "err" }
            : v,
        ),
      );
    } finally {
      setRunning(false);
    }
  };

  const toggle_expand = (id: string) =>
    setVideos((prev) => prev.map((v) => v.id === id ? { ...v, expanded: !v.expanded } : v));

  const delete_video = (id: string) =>
    setVideos((prev) => prev.filter((v) => v.id !== id));

  return (
    <div className="ps-split">
      {/* ── 왼쪽: 설정 ── */}
      <aside className="ps-config">
        {/* 타이틀 */}
        <div className="ps-pane-head">
          <div className="ps-pane-head__icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
            </svg>
          </div>
          <span className="ps-pane-head__title">{t("prompting.video_title")}</span>
        </div>

        {/* 모델 */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.model")}</span>
          <StudioModelPicker value={model} onChange={setModel} purpose="video" />
        </div>

        {/* Size + Duration */}
        <div className="ps-pane-sec">
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">{t("prompting.size")}</span>
            <select className="ps-select-sm" value={size} onChange={(e) => setSize(e.target.value)}>
              {VIDEO_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ps-setting-row">
            <span className="ps-setting-row__label">{t("prompting.seconds")}</span>
            <select className="ps-select-sm" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {VIDEO_SECONDS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* 레퍼런스 이미지 (optional) */}
        <div className="ps-pane-sec">
          <span className="ps-pane-sec__label">{t("prompting.ref_image")} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("prompting.optional")}</span></span>
          <span className="ps-pane-sec__desc">{t("prompting.ref_image_desc")}</span>
          <div className="ps-upload-row">
            <input
              className="ps-upload-input"
              placeholder={t("prompting.ref_image_ph")}
              value={ref_url}
              onChange={(e) => setRefUrl(e.target.value)}
            />
            <button className="ps-upload-btn">{t("prompting.upload")}</button>
          </div>
          <div className="ps-drop-zone" onDragOver={(e) => e.preventDefault()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            {t("prompting.drag_drop")}
          </div>
        </div>

        {/* 프롬프트 */}
        <div className="ps-pane-sec ps-pane-sec--grow ps-pane-sec--noborder">
          <span className="ps-pane-sec__label">{t("prompting.prompt")}</span>
          <textarea
            className="ps-prompt-area ps-prompt-area--grow"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("prompting.video_prompt_ph")}
          />
          <button
            className={`ps-run-btn-main${running ? " ps-run-btn-main--running" : ""}`}
            style={{ marginTop: 4 }}
            disabled={running || !model.provider_id || !prompt.trim()}
            onClick={() => void handle_run()}
          >
            {running
              ? <>⏳ {t("prompting.generating")}</>
              : <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t("prompting.generate_btn")}
                </>
            }
          </button>
        </div>
      </aside>

      {/* ── 오른쪽: Recent Videos ── */}
      <main className="ps-preview">
        <div className="ps-preview-head">
          <div className="ps-preview-head__top">
            <span className="ps-preview-head__icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
                <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </span>
            <span className="ps-preview-head__title">{t("prompting.recent_videos")}</span>
          </div>
          <div className="ps-preview-head__sub">{t("prompting.videos_expire")}</div>
        </div>

        <div className="ps-output-area">
          {videos.length === 0 ? (
            <div className="ps-preview-empty">
              <div className="ps-preview-empty__icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
              </div>
              <span>{t("prompting.videos_empty")}</span>
            </div>
          ) : (
            <div className="ps-video-list">
              {videos.map((v) => (
                <div key={v.id} className="ps-video-item">
                  {/* 헤더 행 */}
                  <div className="ps-video-item__head" onClick={() => toggle_expand(v.id)}>
                    <div className={`ps-video-item__dot ps-video-item__dot--${v.status}`} />
                    <div className="ps-video-item__text">
                      <div className="ps-video-item__prompt">{v.prompt}</div>
                      <div className="ps-video-item__meta">
                        {v.model} · {v.seconds}s · {v.size} · {time_ago(v.created_at)}
                      </div>
                    </div>
                    <svg
                      className={`ps-video-item__chevron${v.expanded ? " ps-video-item__chevron--open" : ""}`}
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>

                  {/* 펼쳐진 콘텐츠 */}
                  {v.expanded && (
                    <div className="ps-video-item__body">
                      {v.status === "pending" && (
                        <div style={{ padding: "24px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--muted)", fontSize: 13 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                            <path d="M21 12a9 9 0 11-18 0"/><path d="M21 12a9 9 0 00-9-9"/>
                          </svg>
                          {t("prompting.video_generating")}
                        </div>
                      )}

                      {v.status === "ok" && v.video_url && (
                        <div className="ps-video-item__player">
                          <video src={v.video_url} controls poster={v.thumbnail_url} />
                        </div>
                      )}

                      {v.status === "ok" && v.thumbnail_url && !v.video_url && (
                        <div className="ps-video-item__player">
                          <img src={v.thumbnail_url} alt="Video thumbnail" />
                        </div>
                      )}

                      {v.status === "err" && (
                        <div style={{ padding: "10px 0", fontSize: 13, color: "var(--err)" }}>
                          ⚠ 생성 중 오류가 발생했습니다.
                        </div>
                      )}

                      <div className="ps-video-item__desc">{v.prompt}</div>

                      {v.id && !v.id.startsWith("vid_") && (
                        <div className="ps-video-item__stats">
                          Video ID: {v.id}
                        </div>
                      )}

                      {(v.elapsed_ms != null || v.cost_usd != null) && (
                        <div className="ps-video-item__stats">
                          {v.elapsed_ms != null && `Elapsed: ${(v.elapsed_ms / 1000).toFixed(1)}s`}
                          {v.elapsed_ms != null && v.cost_usd != null && " / "}
                          {v.cost_usd != null && `Cost: $${v.cost_usd.toFixed(2)}`}
                        </div>
                      )}

                      <div className="ps-video-item__actions">
                        {v.video_url && (
                          <a
                            href={v.video_url}
                            download={`video-${v.id}.mp4`}
                            className="btn btn--sm"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            {t("prompting.download")}
                          </a>
                        )}
                        <button className="btn btn--sm btn--danger" onClick={() => delete_video(v.id)}>
                          {t("prompting.delete")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
