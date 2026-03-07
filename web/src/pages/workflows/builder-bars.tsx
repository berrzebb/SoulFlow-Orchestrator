/**
 * Builder utility bars — WorkflowPromptBar, NodeRunInputBar.
 */

import { useState } from "react";
import { api } from "../../api/client";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { WorkflowDef } from "./workflow-types";

/** 자연어 워크플로우 편집 입력바 — "Suggest an edit" 스타일. */
export function WorkflowPromptBar({ workflow, onApply }: {
  workflow: WorkflowDef;
  onApply: (updated: WorkflowDef) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const text = value.trim();
    if (!text || loading) return;
    setLoading(true);
    try {
      const res = await api.post<{ workflow?: WorkflowDef; error?: string }>("/api/workflow/suggest", {
        instruction: text,
        workflow,
      });
      if (res.error) {
        toast(res.error, "err");
      } else if (res.workflow) {
        onApply(res.workflow);
        setValue("");
        toast(t("workflows.prompt_applied"), "ok");
      }
    } catch {
      toast(t("workflows.prompt_failed"), "err");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`workflow-prompt-bar${loading ? " workflow-prompt-bar--loading" : ""}`}>
      {loading && <div className="workflow-prompt-bar__shimmer" />}
      <input
        className="workflow-prompt-bar__input"
        placeholder={t("workflows.prompt_placeholder")}
        aria-label={t("workflows.prompt_placeholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        disabled={loading}
      />
      <button
        className="workflow-prompt-bar__send"
        onClick={() => void send()}
        disabled={!value.trim() || loading}
        aria-label={t("workflows.prompt_send")}
      >
        {loading ? <span className="workflow-prompt-bar__spinner" /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
      </button>
    </div>
  );
}

/** Phase Run 전 objective 입력 바. */
export function NodeRunInputBar({ nodeId, onSubmit, onCancel }: {
  nodeId: string;
  onSubmit: (objective: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <div className="node-run-input-bar">
      <strong className="builder-run-label">{t("workflows.run_prefix", { id: nodeId })}</strong>
      <input
        className="input input--sm flex-1"
        placeholder={t("workflows.run_objective_placeholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSubmit(value.trim()); }}
        autoFocus
      />
      <button className="btn btn--sm btn--primary" onClick={() => { if (value.trim()) onSubmit(value.trim()); }} disabled={!value.trim()}>
        {t("workflows.run_execute")}
      </button>
      <button className="btn btn--sm" onClick={onCancel}>{t("workflows.cancel")}</button>
    </div>
  );
}
