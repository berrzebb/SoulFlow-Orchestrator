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
  onStop: () => void;
}

export function ChatBottomBar({
  session_label,
  is_busy, is_streaming, tool_name, active_session_id,
  onStop,
}: ChatBottomBarProps) {
  const t = useT();
  const [elapsed_s, setElapsedS] = useState(0);

  useEffect(() => {
    if (!is_busy) { setElapsedS(0); return; }
    setElapsedS(0);
    const id = setInterval(() => setElapsedS((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [is_busy]);

  if (is_busy) {
    const elapsed_str = `${Math.floor(elapsed_s / 60)}m ${elapsed_s % 60}s`;
    const phase = tool_name
      ? t("chat.tool_label", { name: tool_name })
      : is_streaming ? t("chat.responding") : t("chat.thinking");
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
        <button className="chat-bottom-bar__stop" onClick={onStop} aria-label={t("chat.stop")}>
          ■ {t("chat.stop")}
        </button>
      </div>
    );
  }

  return null;
}
