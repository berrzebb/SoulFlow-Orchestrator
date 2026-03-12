/** 스트리밍 중 도구 호출 시각화 — 진행 중 / 완료 / 오류 상태 표시. */

import { useState } from "react";
import type { ToolCallEntry } from "../../hooks/use-ndjson-stream";

const ICONS: [RegExp, string][] = [
  [/^web_search|^search_web/, "🔍"],
  [/^web_fetch|^web_extract|^web_pdf|^web_snapshot/, "📄"],
  [/^web_browser|^web_form|^web_auth|^web_monitor|^web_table/, "🌐"],
  [/^screenshot/, "📸"],
  [/^canvas_render/, "🎨"],
  [/^diagram_render/, "📊"],
  [/^shell_exec|^exec/, "💻"],
  [/^git/, "📝"],
  [/^docker/, "🐋"],
  [/^read_file|^write_file|^list_dir|^search_files|^edit_file/, "📁"],
  [/^memory|^knowledge/, "🧠"],
  [/^send_message|^ask_user|^message/, "💬"],
  [/^cron/, "⏰"],
  [/^spawn/, "🤖"],
  [/^http_request|^oauth_fetch/, "🔗"],
  [/^database|^sql/, "🗃️"],
  [/^decision/, "⚖️"],
];

function tool_icon(name: string): string {
  for (const [re, icon] of ICONS) {
    if (re.test(name)) return icon;
  }
  return "🔧";
}

export function ToolCallList({ calls }: { calls: ToolCallEntry[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="tool-call-list">
      {calls.map((c) => (
        <ToolCallBlock key={c.id} entry={c} />
      ))}
    </div>
  );
}

function ToolCallBlock({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const status_cls = entry.done ? (entry.is_error ? "error" : "done") : "pending";

  return (
    <div className={`tool-call tool-call--${status_cls}`}>
      <button
        className="tool-call__header"
        onClick={() => entry.done && setExpanded((e) => !e)}
        style={{ cursor: entry.done ? "pointer" : "default" }}
        aria-expanded={entry.done ? expanded : undefined}
        aria-label={`${entry.name} ${entry.done ? (entry.is_error ? "failed" : "succeeded") : "running"}`}
      >
        <span className="tool-call__status-icon">
          {!entry.done
            ? <span className="tool-call__spinner" aria-hidden="true" />
            : entry.is_error
              ? <span className="tool-call__x" aria-hidden="true">✗</span>
              : <span className="tool-call__check" aria-hidden="true">✓</span>}
        </span>
        <span className="tool-call__icon" aria-hidden="true">{tool_icon(entry.name)}</span>
        <span className="tool-call__name">{entry.name}</span>
        {entry.done && (
          <span className="tool-call__expand-icon" aria-hidden="true">{expanded ? "▲" : "▼"}</span>
        )}
      </button>

      {expanded && entry.done && (
        <div className="tool-call__detail">
          {entry.params && Object.keys(entry.params).length > 0 && (
            <section className="tool-call__section">
              <div className="tool-call__section-label">Params</div>
              <pre className="tool-call__pre">{JSON.stringify(entry.params, null, 2)}</pre>
            </section>
          )}
          {entry.result && (
            <section className="tool-call__section">
              <div className="tool-call__section-label">{entry.is_error ? "Error" : "Result"}</div>
              <pre className={`tool-call__pre${entry.is_error ? " tool-call__pre--error" : ""}`}>
                {entry.result.length > 1200
                  ? `${entry.result.slice(0, 1200)}\n… (${entry.result.length - 1200} chars truncated)`
                  : entry.result}
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
