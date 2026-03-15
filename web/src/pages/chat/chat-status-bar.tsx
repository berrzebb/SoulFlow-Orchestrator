/** 처리 중 상태바 — Thinking/Responding/Tool + 경과 시간 + Stop (busy 시에만 렌더) */

import { useEffect, useState } from "react";
import { useT } from "../../i18n";

interface ChatBottomBarProps {
  /** 세션 레이블 */
  session_label: string;
  is_busy: boolean;
  is_streaming: boolean;
  tool_name?: string | null;
  /** 처리 중인 세션 ID (칩으로 표시) */
  active_session_id?: string | null;
  /**
   * FE-2: 채널 어피니티 — 요청된 채널 ID와 실제 전달 채널이 다를 때 경고 배지 표시.
   * 예: 웹 요청이 Slack 채널로 라우팅된 경우.
   */
  requested_channel?: string | null;
  delivered_channel?: string | null;
  /** FE-2: 이전 세션 재사용 중 여부 (EG 트랙 세션 재사용 정책). */
  session_reuse?: boolean;
  onStop: () => void;
}

export function ChatBottomBar({
  session_label, is_busy, is_streaming, tool_name, active_session_id,
  requested_channel, delivered_channel, session_reuse, onStop,
}: ChatBottomBarProps) {
  if (!is_busy) return null;

  // BusyBar는 is_busy=true일 때만 마운트 → elapsed 상태가 자동으로 0에서 시작
  return (
    <BusyBar
      session_label={session_label}
      is_streaming={is_streaming}
      tool_name={tool_name ?? null}
      active_session_id={active_session_id ?? null}
      requested_channel={requested_channel ?? null}
      delivered_channel={delivered_channel ?? null}
      session_reuse={session_reuse ?? false}
      onStop={onStop}
    />
  );
}

/** is_busy=true 시에만 마운트되는 내부 컴포넌트 — 마운트 즉시 elapsed=0에서 시작. */
function BusyBar({
  session_label, is_streaming, tool_name, active_session_id,
  requested_channel, delivered_channel, session_reuse, onStop,
}: {
  session_label: string; is_streaming: boolean; tool_name: string | null;
  active_session_id: string | null; requested_channel: string | null;
  delivered_channel: string | null; session_reuse: boolean; onStop: () => void;
}) {
  const t = useT();
  const [elapsed_s, setElapsedS] = useState(0);

  // 인터벌에서만 setState — 마운트 시 elapsed=0, 언마운트 시 자동 정리
  useEffect(() => {
    const id = setInterval(() => setElapsedS((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed_str = `${Math.floor(elapsed_s / 60)}m ${elapsed_s % 60}s`;
  const phase = tool_name
    ? t("chat.tool_label", { name: tool_name })
    : is_streaming ? t("chat.responding") : t("chat.thinking");
  const channel_mismatch = requested_channel && delivered_channel && requested_channel !== delivered_channel;

  return (
    <div className="chat-bottom-bar chat-bottom-bar--busy">
      <span className="chat-bottom-bar__label">
        <span className="chat-bottom-bar__dot" />
        {session_label}
      </span>
      <span className="chat-bottom-bar__phase">{phase}</span>
      <span className="chat-bottom-bar__elapsed">{elapsed_str}</span>
      {active_session_id && (
        <span className="chat-bottom-bar__run-id">{active_session_id.slice(0, 8).toUpperCase()}</span>
      )}
      {/* FE-2: 채널 미스매치 경고 */}
      {channel_mismatch && (
        <span
          className="chat-bottom-bar__channel-warn"
          title={t("chat.channel_mismatch_hint", { requested: requested_channel!, delivered: delivered_channel! })}
          aria-label={t("chat.channel_mismatch")}
        >
          ⚡ {delivered_channel}
        </span>
      )}
      {/* FE-2: 세션 재사용 칩 */}
      {session_reuse && (
        <span className="chat-bottom-bar__reuse-chip" title={t("chat.session_reuse_hint")}>
          ↩ {t("chat.session_reuse")}
        </span>
      )}
      <button className="chat-bottom-bar__stop" onClick={onStop} aria-label={t("chat.stop")}>
        ■ {t("chat.stop")}
      </button>
    </div>
  );
}
