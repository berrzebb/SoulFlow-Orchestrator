/**
 * Builder utility bars — WorkflowPromptBar, NodeRunInputBar.
 */

import { useState, useEffect, useRef } from "react";
import { ChatPromptBar } from "../../components/chat-prompt-bar";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import type { WorkflowDef, PhaseDef, FieldMapping } from "./workflow-types";

// ── Section 패치 헬퍼 ──────────────────────────────────────────

type ArrKey = "phases" | "trigger_nodes" | "tool_nodes" | "skill_nodes" | "orche_nodes";
const SECTION_ARR_MAP: Record<string, { arr: ArrKey; key: string }> = {
  phase:   { arr: "phases",         key: "phase_id" },
  trigger: { arr: "trigger_nodes",  key: "id"       },
  tool:    { arr: "tool_nodes",     key: "id"       },
  skill:   { arr: "skill_nodes",    key: "id"       },
  orche:   { arr: "orche_nodes",    key: "node_id"  },
};

function apply_patch(wf: WorkflowDef, path: string, section: Record<string, unknown> | unknown[]): void {
  if (path === "metadata") {
    const s = section as Record<string, unknown>;
    if (s.title     !== undefined) wf.title     = s.title     as string;
    if (s.objective !== undefined) wf.objective = s.objective as string;
    if (s.variables !== undefined) wf.variables = s.variables as Record<string, string>;
    return;
  }
  if (path === "field_mappings") {
    wf.field_mappings = section as unknown as FieldMapping[];
    return;
  }
  const colon = path.indexOf(":");
  if (colon < 0) return;
  const m = SECTION_ARR_MAP[path.slice(0, colon)];
  if (!m) return;
  const id = path.slice(colon + 1);
  const arr = ((wf as unknown as Record<string, unknown>)[m.arr] as Array<Record<string, unknown>> | undefined) ?? [];
  const idx = arr.findIndex((x) => String(x[m.key]) === id);
  const merged = idx < 0
    ? { [m.key]: id, ...(section as Record<string, unknown>) }
    : { ...arr[idx], ...(section as Record<string, unknown>) };
  if (idx < 0) arr.push(merged); else arr[idx] = merged;
  (wf as unknown as Record<string, unknown>)[m.arr] = arr;
}

// ── WorkflowPromptBar ─────────────────────────────────────────

/** 자연어 워크플로우 편집 입력바 — SSE 스트리밍으로 섹션 패치 실시간 반영.
 * - name: 기존 템플릿 슬러그 (파일 저장소에서 로드)
 * - workflow: 미저장 상태 직접 전달
 * - 둘 다 없으면 신규 생성 모드 (instruction만 전송)
 */
export function WorkflowPromptBar({ name, workflow, onApply, initialPrompt }: {
  name?: string;
  workflow?: WorkflowDef;
  onApply: (updated: WorkflowDef) => void;
  initialPrompt?: string;
}) {
  const t = useT();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState(initialPrompt ?? "");
  const auto_fired = useRef(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  const send = (override_text?: string) => {
    const text = (override_text ?? value).trim();
    if (!text || loading) return;

    // 현재 워크플로우 스냅샷 (스트리밍 중 점진적 패치 대상)
    const wf = workflow ? JSON.parse(JSON.stringify(workflow)) as WorkflowDef : null;
    setLoading(true);

    void (async () => {
      try {
        const body: Record<string, unknown> = { instruction: text };
        // 항상 현재 in-memory 워크플로우를 전달 (name만 보내면 파일 재로드로 이전 변경사항 소실)
        if (wf) body.workflow = wf;
        if (name) body.name = name;
        if (selectedProvider) body.provider_instance_id = selectedProvider;
        if (selectedModel) body.model = selectedModel;

        const response = await fetch("/api/workflow/suggest/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(chunk, { stream: true });

          // SSE 이벤트는 \n\n 으로 구분
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const part of parts) {
            const event = part.match(/^event:\s*(\w+)/m)?.[1];
            const raw   = part.match(/^data:\s*(.+)$/m)?.[1];
            if (!raw) continue;
            try {
              const data = JSON.parse(raw) as Record<string, unknown>;
              if (event === "patch") {
                if (wf) {
                  apply_patch(wf, data.path as string, data.section as Record<string, unknown>);
                  onApply({ ...wf, phases: [...(wf.phases ?? [])] as PhaseDef[] });
                }
              } else if (event === "done") {
                if (data.workflow) onApply(data.workflow as WorkflowDef);
                setValue("");
                toast(t("workflows.prompt_applied"), "ok");
                return;
              } else if (event === "error") {
                throw new Error(String(data.error || "suggest failed"));
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
          }
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : t("workflows.prompt_failed"), "err");
      } finally {
        setLoading(false);
      }
    })();
  };

  // initialPrompt가 있으면 마운트 시 1회 자동 실행 — 클로저 의존 우회를 위해 텍스트 직접 전달
  useEffect(() => {
    if (initialPrompt && !auto_fired.current) {
      auto_fired.current = true;
      send(initialPrompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        popupPlacement="down"
        className="workflow-prompt-bar__prompt"
      />
    </div>
  );
}

// ── NodeRunInputBar ───────────────────────────────────────────

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
        popupPlacement="down"
      />
    </div>
  );
}
