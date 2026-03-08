/**
 * Builder utility bars — WorkflowPromptBar, NodeRunInputBar.
 */

import { useState } from "react";
import { api } from "../../api/client";
import { ChatPromptBar } from "../../components/chat-prompt-bar";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { WorkflowDef } from "./workflow-types";

/** 자연어 워크플로우 편집 입력바 — 프로바이더/모델 선택 포함. */
export function WorkflowPromptBar({ workflow, onApply }: {
  workflow: WorkflowDef;
  onApply: (updated: WorkflowDef) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  const send = async () => {
    const text = value.trim();
    if (!text || loading) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = { instruction: text, workflow };
      if (selectedProvider) body.provider_instance_id = selectedProvider;
      if (selectedModel) body.model = selectedModel;
      const res = await api.post<{ workflow?: WorkflowDef; error?: string }>("/api/workflow/suggest", body);
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
      <ChatPromptBar
        input={value}
        setInput={setValue}
        sending={loading}
        can_send={!!value.trim() && !loading}
        onSend={send}
        placeholder={t("workflows.prompt_placeholder")}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onProviderChange={setSelectedProvider}
        onModelChange={setSelectedModel}
        className="workflow-prompt-bar__prompt"
      />
    </div>
  );
}

/** Phase Run 전 objective 입력 바. */
export function NodeRunInputBar({ nodeId, onSubmit, onCancel }: {
  nodeId: string;
  onSubmit: (objective: string, provider_instance_id?: string, model?: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  return (
    <div className="node-run-input-bar">
      <div className="node-run-input-bar__header">
        <strong className="builder-run-label">{t("workflows.run_prefix", { id: nodeId })}</strong>
        <button className="btn btn--xs" onClick={onCancel}>{t("common.cancel")}</button>
      </div>
      <ChatPromptBar
        input={value}
        setInput={setValue}
        sending={false}
        can_send={!!value.trim()}
        onSend={() => { if (value.trim()) onSubmit(value.trim(), selectedProvider || undefined, selectedModel || undefined); }}
        placeholder={t("workflows.run_objective_placeholder")}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onProviderChange={setSelectedProvider}
        onModelChange={setSelectedModel}
      />
    </div>
  );
}
