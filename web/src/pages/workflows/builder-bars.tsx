/**
 * Builder utility bars — WorkflowPromptBar, NodeRunInputBar.
 */

import { useState } from "react";
import { api } from "../../api/client";
import { InputBar } from "../../components/input-bar";
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
      <InputBar
        value={value}
        onChange={setValue}
        placeholder={t("workflows.prompt_placeholder")}
        ariaLabel={t("workflows.prompt_placeholder")}
        onSubmit={send}
        submitLabel={loading ? "…" : "↑"}
        submitDisabled={!value.trim()}
        disabled={loading}
        loading={loading}
        showShimmer={loading}
        autoFocus
        className="workflow-prompt-bar__input-bar"
      />
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
      <InputBar
        value={value}
        onChange={setValue}
        placeholder={t("workflows.run_objective_placeholder")}
        onSubmit={() => { if (value.trim()) onSubmit(value.trim()); }}
        submitLabel={t("workflows.run_execute")}
        submitDisabled={!value.trim()}
        onCancel={onCancel}
        autoFocus
      />
    </div>
  );
}
