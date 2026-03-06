import { useState } from "react";
import { Badge } from "./badge";
import { useT } from "../i18n";

export interface PendingApproval {
  request_id: string;
  tool_name: string;
  status: string;
  created_at: string;
  params?: Record<string, unknown>;
  context?: { channel?: string; chat_id?: string; task_id?: string };
}

export function ApprovalBanner({ approval, onResolve }: {
  approval: PendingApproval;
  onResolve: (text: string) => void;
}) {
  const t = useT();
  const [show_params, setShowParams] = useState(false);
  const [custom_mode, setCustomMode] = useState(false);
  const [custom_text, setCustomText] = useState("");

  const has_params = approval.params && Object.keys(approval.params).length > 0;

  const handle_custom = () => {
    if (!custom_text.trim()) return;
    onResolve(custom_text.trim());
    setCustomText("");
    setCustomMode(false);
  };

  return (
    <div className="chat-approval">
      <div className="chat-approval__header">
        <Badge status={approval.tool_name} variant="warn" />
        {approval.context?.channel && <Badge status={approval.context.channel} variant="info" />}
        {approval.context?.task_id && (
          <span className="text-muted text-xs">
            task:{approval.context.task_id.slice(0, 10)}
          </span>
        )}
        <span className="chat-approval__time text-muted text-xs">
          {new Date(approval.created_at).toLocaleTimeString("sv-SE")}
        </span>
      </div>

      {has_params && (
        <div className="chat-approval__params">
          <button
            className="chat-approval__params-btn"
            aria-expanded={show_params}
            onClick={() => setShowParams((v) => !v)}
          >
            {show_params ? "▼" : "▶"} {t("chat.params_toggle")} ({Object.keys(approval.params!).length})
          </button>
          {show_params && (
            <pre className="chat-approval__params-code">
              {JSON.stringify(approval.params, null, 2)}
            </pre>
          )}
        </div>
      )}

      {custom_mode ? (
        <div className="chat-approval__custom">
          <textarea
            className="chat-approval__custom-textarea"
            value={custom_text}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && custom_text.trim()) { e.preventDefault(); handle_custom(); } }}
            placeholder={t("chat.custom_response_hint")}
            rows={2}
          />
          <div className="chat-approval__custom-btns">
            <button className="btn btn--xs btn--ok" onClick={handle_custom} disabled={!custom_text.trim()}>
              {t("common.send")}
            </button>
            <button className="btn btn--xs" onClick={() => { setCustomMode(false); setCustomText(""); }}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-approval__actions">
          <button className="btn btn--xs btn--ok fw-600" onClick={() => onResolve("approve")}>
            ✅ {t("chat.approve")}
          </button>
          <button className="btn btn--xs btn--danger" onClick={() => onResolve("deny")}>
            ❌ {t("chat.deny")}
          </button>
          <button className="btn btn--xs text-muted" onClick={() => setCustomMode(true)}>
            💬 {t("chat.custom_response")}
          </button>
        </div>
      )}
    </div>
  );
}
