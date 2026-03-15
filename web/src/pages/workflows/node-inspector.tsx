/**
 * NodeInspector — n8n 스타일 노드 인스펙션 사이드 패널.
 * Parameters 탭: registry EditPanel, Phase/Agent/Critic 내장 패널.
 * Output 탭: 실행 결과 스키마 기반 표시 + 드래그 가능 필드.
 */

import { useState, useRef, useEffect } from "react";
import { get_frontend_node, type NodeOptions } from "./node-registry";
import type { OutputField } from "./output-schema";
import type { TFunction } from "../../../../src/i18n/protocol";
import { PHASE_OUTPUT, PHASE_INPUT } from "./output-schema";
import type { PhaseDef, WorkflowDef } from "./workflow-types";
import { PhaseParamsPanel, SubNodeParamsPanel, EndTargetParamsPanel } from "./inspector-params";
import { InputSectionPanel, NodeOutputView } from "./inspector-output";

const INSPECTOR_SUB_COLOR: Record<string, string> = {
  agent: "#3498db", critic: "#e74c3c", tool_sub: "#f39c12", skill_sub: "#2ecc71",
  end_channel: "#3498db", end_media: "#e67e22", end_webhook: "#ff9800", end_http: "#1abc9c",
};

const SVG_ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** 노드 실행 상태 (PhaseLoopState.orche_states 항목). */
export interface NodeExecutionState {
  node_id: string;
  node_type: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  started_at?: string;
  completed_at?: string;
  /** FE-3: SchemaChain Validator 결과 — undefined = 검증 미수행. */
  schema_valid?: boolean;
  /** FE-3: SchemaRepairLoop가 자동 수정한 경우 true. */
  schema_repaired?: boolean;
}

/** 상류 노드의 드래그 가능 출력 참조. */
export interface UpstreamRef {
  node_id: string;
  node_label: string;
  fields: OutputField[];
}

export interface NodeInspectorProps {
  /** 노드 원본 데이터 (orche_data, phase, trigger 등). */
  node: Record<string, unknown>;
  node_id: string;
  node_type: string;
  node_label: string;
  execution_state?: NodeExecutionState;
  onUpdate: (partial: Record<string, unknown>) => void;
  onClose: () => void;
  t: TFunction;
  options?: NodeOptions;
  /** Phase 노드 전용: 워크플로우 + 업데이트 콜백 (sub-node 편집용). */
  workflow?: WorkflowDef;
  onWorkflowChange?: (w: WorkflowDef) => void;
  /** 이 노드에 연결된 상류 노드들의 출력 필드 목록 (드래그 참조용). */
  upstream_refs?: UpstreamRef[];
  /** Phase/Agent 등 ID 변경 시 부모의 inspectorNodeId 동기화. */
  onNodeIdChange?: (newId: string) => void;
}

export function NodeInspector({
  node, node_id, node_type, node_label, execution_state,
  onUpdate, onClose, t, options, workflow, onWorkflowChange, upstream_refs, onNodeIdChange,
}: NodeInspectorProps) {
  const desc = get_frontend_node(node_type);

  const isPhase = node_type === "phase";
  const isSubNode = node_type === "agent" || node_type === "critic" || node_type === "tool_sub" || node_type === "skill_sub";
  const isEndTarget = node_type.startsWith("end_");

  const color = isPhase ? "var(--accent, #89b4fa)" : (isSubNode || isEndTarget) ? (INSPECTOR_SUB_COLOR[node_type] || "var(--accent)") : (desc?.color || "var(--accent, #89b4fa)");

  const svgIcon = (() => {
    if (isPhase) return <svg {...SVG_ICON_PROPS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    if (node_type === "agent") return <svg {...SVG_ICON_PROPS}><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="5" r="4"/></svg>;
    if (node_type === "critic") return <svg {...SVG_ICON_PROPS}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    if (node_type === "tool_sub") return <svg {...SVG_ICON_PROPS}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>;
    if (node_type === "skill_sub") return <svg {...SVG_ICON_PROPS}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    if (node_type === "end_channel") return <svg {...SVG_ICON_PROPS}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    if (node_type === "end_media") return <svg {...SVG_ICON_PROPS}><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>;
    if (node_type === "end_webhook") return <svg {...SVG_ICON_PROPS}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>;
    if (node_type === "end_http") return <svg {...SVG_ICON_PROPS}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
    if (desc?.icon) return <span>{desc.icon}</span>;
    return <svg {...SVG_ICON_PROPS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
  })();

  const EditPanel = desc?.EditPanel;
  const output_schema = isPhase ? PHASE_OUTPUT : (desc?.output_schema || []);
  const input_schema = isPhase ? PHASE_INPUT : (desc?.input_schema || []);

  const [inputOpen, setInputOpen] = useState(true);
  const [paramsOpen, setParamsOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(true);

  const [width, setWidth] = useState(400);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - e.clientX;
      setWidth(Math.max(280, Math.min(800, dragRef.current.startW + delta)));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const hasInput = input_schema.length > 0 || (upstream_refs && upstream_refs.length > 0);

  return (
    <div className="node-inspector" style={{ width, "--inspector-color": color } as React.CSSProperties}>
      <div className="inspector-resize-handle" onMouseDown={onResizeStart} />
      <div className="inspector-header">
        <span className="inspector-icon" style={{ color }}>{svgIcon}</span>
        <span className="inspector-title">{node_label || node_type}</span>
        <span className="inspector-node-id">{node_id}</span>
        <button className="inspector-close" onClick={onClose} title={t("workflows.close")} aria-label={t("workflows.close")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="inspector-body">
        {hasInput && (
          <div className="inspector-section-block">
            <button className="inspector-section-toggle" aria-expanded={inputOpen} onClick={() => setInputOpen(!inputOpen)}>
              <span><svg className={`inspector-chevron${inputOpen ? "" : " inspector-chevron--closed"}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>{t("workflows.section_input")}</span>
              <span className="inspector-section-count">{t("workflows.n_fields", { n: String(input_schema.length) })}</span>
            </button>
            {inputOpen && (
              <InputSectionPanel
                input_schema={input_schema}
                upstream_refs={upstream_refs || []}
                node_id={node_id}
                workflow={workflow}
              />
            )}
          </div>
        )}

        <div className="inspector-section-block">
          <button className="inspector-section-toggle" aria-expanded={paramsOpen} onClick={() => setParamsOpen(!paramsOpen)}>
            <span><svg className={`inspector-chevron${paramsOpen ? "" : " inspector-chevron--closed"}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>{t("workflows.section_params")}</span>
          </button>
          {paramsOpen && (
            <div className="inspector-section-content">
              {isPhase && workflow && onWorkflowChange && (
                <PhaseParamsPanel
                  phase={node as unknown as PhaseDef}
                  workflow={workflow}
                  onChange={onWorkflowChange}
                  onPhaseIdChange={onNodeIdChange}
                  t={t}
                  options={options}
                />
              )}
              {isSubNode && workflow && onWorkflowChange && (
                <SubNodeParamsPanel
                  subNodeId={node_id}
                  subType={node_type as "agent" | "critic" | "tool_sub" | "skill_sub"}
                  workflow={workflow}
                  onChange={onWorkflowChange}
                  onNodeIdChange={onNodeIdChange}
                  t={t}
                  options={options}
                />
              )}
              {isEndTarget && (
                <EndTargetParamsPanel target={node_type.slice(4)} node={node} onUpdate={onUpdate} t={t} />
              )}
              {!isPhase && !isSubNode && !isEndTarget && EditPanel && (
                <EditPanel node={node} update={onUpdate} t={t} options={options} />
              )}
              {!isPhase && !isSubNode && !isEndTarget && !EditPanel && (
                <div className="inspector-empty">{t("workflows.no_edit_panel")}</div>
              )}
            </div>
          )}
        </div>

        <div className="inspector-section-block">
          <button className="inspector-section-toggle" aria-expanded={outputOpen} onClick={() => setOutputOpen(!outputOpen)}>
            <span><svg className={`inspector-chevron${outputOpen ? "" : " inspector-chevron--closed"}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>{t("workflows.section_output")}</span>
            {execution_state?.status === "completed" && <span className="tab-badge tab-badge--ok"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>}
            {execution_state?.status === "failed" && <span className="tab-badge tab-badge--err"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>}
            {execution_state?.status === "running" && <span className="tab-badge tab-badge--run"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></span>}
          </button>
          {outputOpen && (
            <NodeOutputView state={execution_state} schema={output_schema} node_id={node_id} />
          )}
        </div>
      </div>
    </div>
  );
}
