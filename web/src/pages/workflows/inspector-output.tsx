/**
 * Inspector output view — Tree/JSON/Schema display with draggable fields.
 */

import { useState } from "react";
import { useT } from "../../i18n";
import type { OutputField } from "./output-schema";
import type { WorkflowDef } from "./workflow-types";
import type { NodeExecutionState, UpstreamRef } from "./node-inspector";
import { handleOutputFieldDragStart, handleTreeFieldDrag } from "./inspector-dnd";

// ── Input Section: 입력 스키마 + 상류 드래그 소스 ──

export function InputSectionPanel({ input_schema, upstream_refs, node_id, workflow }: {
  input_schema: OutputField[];
  upstream_refs: UpstreamRef[];
  node_id: string;
  workflow?: WorkflowDef;
}) {
  const t = useT();
  const mappings = workflow?.field_mappings || [];
  const getMappedSource = (fieldName: string) =>
    mappings.find((m) => m.to_node === node_id && m.to_field === fieldName);

  return (
    <div className="input-section">
      {input_schema.length > 0 && (
        <div className="input-schema-list">
          {input_schema.map((field) => {
            const mapped = getMappedSource(field.name);
            return (
              <div key={field.name} className="input-schema-row">
                <div className="input-schema-row__header">
                  <span className="field-name">{field.name}</span>
                  <span className="field-type" data-ft={field.type}>{field.type}</span>
                </div>
                {field.description && <div className="field-description">{field.description}</div>}
                {mapped && (
                  <div className="input-schema-row__mapped">
                    {`← {{${mapped.from_node}.${mapped.from_field}}}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {upstream_refs.length > 0 && (
        <div className="upstream-refs-section">
          <div className="upstream-refs-section__label">{t("workflows.upstream_available")}</div>
          {upstream_refs.map((ref) => (
            <div key={ref.node_id} className="upstream-refs__group">
              <div className="upstream-refs__node-label">{ref.node_label}</div>
              {ref.fields.map((field) => (
                <div
                  key={field.name}
                  className="upstream-refs__field"
                  draggable
                  onDragStart={(e) => handleOutputFieldDragStart(e, ref.node_id, field.name)}
                >
                  <span className="field-drag-handle">⠿</span>
                  <span className="field-name">{field.name}</span>
                  <span className="field-type" data-ft={field.type}>{field.type}</span>
                  <span className="field-ref-tag">{`{{${ref.node_id}.${field.name}}}`}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Output View with Draggable Fields ──

export function NodeOutputView({ state, schema, node_id }: { state?: NodeExecutionState; schema: OutputField[]; node_id: string }) {
  const t = useT();
  const [viewMode, setViewMode] = useState<"tree" | "json" | "schema">("tree");

  const hasResult = state?.status === "completed" && state.result !== undefined;
  const resolved = hasResult ? resolve_output(state!.result) : undefined;

  if (state) {
    if (state.status === "pending") return <div className="inspector-empty output-view-pad">{t("workflows.node_pending")}</div>;
    if (state.status === "running") return <div className="inspector-running output-view-pad"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> {t("workflows.node_running")}</div>;
    if (state.status === "skipped") return <div className="inspector-empty output-view-pad"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> {t("workflows.node_skipped")}</div>;
    if (state.status === "failed") return (
      <div className="output-view-pad">
        <div className="inspector-error">
          <div className="error-header"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> {t("workflows.node_failed")}</div>
          <pre className="error-detail">{state.error || t("workflows.unknown_error")}</pre>
          {state.started_at && <div className="exec-time">{t("workflows.started_at")}: {format_time(state.started_at)}</div>}
          {state.completed_at && <div className="exec-time">{t("workflows.ended_at")}: {format_time(state.completed_at)}</div>}
        </div>
      </div>
    );
  }

  if (!hasResult) {
    return (
      <div className="output-view-pad">
        {schema.length > 0 ? (
          <div className="output-schema-list">
            {schema.map((field) => (
              <div key={field.name} className="output-schema-row">
                <span className="field-name">{field.name}</span>
                <span className="field-type" data-ft={field.type}>{field.type}</span>
                {field.description && <span className="field-description">{field.description}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="inspector-empty">{t("workflows.no_output")}</div>
        )}
      </div>
    );
  }

  return (
    <div className="output-view-pad">
      {(state!.started_at || state!.completed_at) && (
        <div className="exec-times">
          {state!.started_at && <span>{t("workflows.started_at")}: {format_time(state!.started_at)}</span>}
          {state!.completed_at && <span>{t("workflows.ended_at")}: {format_time(state!.completed_at)}</span>}
        </div>
      )}

      <div className="output-view-modes" role="tablist">
        <button className={`output-view-mode${viewMode === "tree" ? " active" : ""}`} role="tab" aria-selected={viewMode === "tree"} onClick={() => setViewMode("tree")}>{t("workflows.tree_view")}</button>
        <button className={`output-view-mode${viewMode === "json" ? " active" : ""}`} role="tab" aria-selected={viewMode === "json"} onClick={() => setViewMode("json")}>{t("workflows.json_view")}</button>
        <button className={`output-view-mode${viewMode === "schema" ? " active" : ""}`} role="tab" aria-selected={viewMode === "schema"} onClick={() => setViewMode("schema")}>{t("workflows.schema_view")}</button>
      </div>

      {viewMode === "tree" && (
        <div className="output-tree">
          <JsonFieldTree value={resolved} path={node_id} node_id={node_id} depth={0} />
        </div>
      )}

      {viewMode === "json" && (
        <pre className="output-json">{format_value(state!.result)}</pre>
      )}

      {viewMode === "schema" && (
        <div className="output-schema-list">
          {schema.length > 0 ? schema.map((field) => {
            const obj = (resolved && typeof resolved === "object" && !Array.isArray(resolved))
              ? resolved as Record<string, unknown>
              : null;
            return (
              <div key={field.name} className="output-schema-row">
                <div className="output-schema-row__header">
                  <span className="field-name">{field.name}</span>
                  <span className="field-type" data-ft={field.type}>{field.type}</span>
                  {field.description && <span className="field-description">{field.description}</span>}
                </div>
                {obj && field.name in obj && (
                  <div className="output-schema-row__tree">
                    <JsonFieldTree value={obj[field.name]} path={`${node_id}.${field.name}`} node_id={node_id} depth={1} />
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="inspector-empty">{t("workflows.no_output_schema")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recursive JSON Field Tree ──

const MAX_TREE_DEPTH = 8;
const MAX_ARRAY_PREVIEW = 20;

function try_parse_json(str: string): unknown | undefined {
  const trimmed = str.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const codeBlock = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* fall through */ }
  }
  const braceStart = trimmed.indexOf("{");
  const bracketStart = trimmed.indexOf("[");
  const start = braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart) ? braceStart : bracketStart;
  if (start >= 0) {
    const sub = trimmed.slice(start);
    if (sub.length >= 20) {
      try { return JSON.parse(sub); } catch { /* fall through */ }
    }
  }
  if (/^\s*"[^"]+"\s*:/.test(trimmed)) {
    try { return JSON.parse(`{${trimmed}}`); } catch { /* fall through */ }
  }
  return undefined;
}

function resolve_output(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = try_parse_json(value);
    if (parsed !== undefined) return resolve_output(parsed);
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolve_output(v));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) resolved[k] = resolve_output(v);
    return resolved;
  }
  return value;
}

function infer_type(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function JsonFieldTree({ value, path, node_id, depth }: {
  value: unknown;
  path: string;
  node_id: string;
  depth: number;
}) {
  if (depth > MAX_TREE_DEPTH) return <span className="output-tree__ellipsis">...</span>;
  if (value === null || value === undefined) return <span className="output-tree__null">null</span>;
  if (typeof value !== "object") return <PrimitiveValue value={value} />;
  if (Array.isArray(value)) return <ArrayFieldTree arr={value} path={path} node_id={node_id} depth={depth} />;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="output-tree__empty">{"{}"}</span>;

  return (
    <div className="output-tree__object" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      {entries.map(([key, val]) => (
        <ObjectFieldRow key={key} fieldKey={key} value={val} path={path} node_id={node_id} depth={depth} />
      ))}
    </div>
  );
}

function ObjectFieldRow({ fieldKey, value, path, node_id, depth }: {
  fieldKey: string;
  value: unknown;
  path: string;
  node_id: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const fieldPath = `${path}.${fieldKey}`;
  const ref = `{{${fieldPath}}}`;
  const isComplex = value !== null && typeof value === "object";
  const valType = infer_type(value);

  return (
    <div className="output-tree__field">
      <div className="output-tree__row">
        {isComplex ? (
          <button className="output-tree__toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? "\u25BE" : "\u25B8"}
          </button>
        ) : (
          <span className="output-tree__toggle-spacer" />
        )}

        <span
          className="output-tree__tag"
          draggable
          onDragStart={(e) => handleTreeFieldDrag(e, fieldPath)}
          title={ref}
        >
          <span className="output-tree__tag-name">{fieldKey}</span>
          <span className="output-tree__tag-type" data-ft={valType}>{valType}</span>
        </span>

        {!isComplex && (
          <span className="output-tree__inline-val">
            <PrimitiveValue value={value} />
          </span>
        )}

        {isComplex && !expanded && (
          <span className="output-tree__summary">
            {Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value as object).length}}`}
          </span>
        )}
      </div>

      {isComplex && expanded && (
        <JsonFieldTree value={value} path={fieldPath} node_id={node_id} depth={depth + 1} />
      )}
    </div>
  );
}

function ArrayFieldTree({ arr, path, node_id, depth }: {
  arr: unknown[];
  path: string;
  node_id: string;
  depth: number;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(depth < 1);
  const preview = arr.slice(0, MAX_ARRAY_PREVIEW);
  const hasMore = arr.length > MAX_ARRAY_PREVIEW;

  const allPrimitive = arr.length > 0 && arr.every((v) => v === null || typeof v !== "object");
  if (allPrimitive && arr.length <= 10) {
    return <span className="output-tree__inline-arr">[{arr.map(String).join(", ")}]</span>;
  }

  return (
    <div className="output-tree__array" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <button className="output-tree__array-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? "\u25BE" : "\u25B8"} {t("workflows.array_label", { n: String(arr.length) })}
      </button>
      {expanded && (
        <>
          {preview.map((item, i) => {
            const itemPath = `${path}[${i}]`;
            if (item !== null && typeof item === "object") {
              return (
                <div key={i} className="output-tree__field">
                  <div className="output-tree__row">
                    <span
                      className="output-tree__tag output-tree__tag--idx"
                      draggable
                      onDragStart={(e) => handleTreeFieldDrag(e, itemPath)}
                      title={`Drag: {{${itemPath}}}`}
                    >
                      <span className="output-tree__tag-name">[{i}]</span>
                      <span className="output-tree__tag-type" data-ft={infer_type(item)}>{infer_type(item)}</span>
                    </span>
                  </div>
                  <JsonFieldTree value={item} path={itemPath} node_id={node_id} depth={depth + 1} />
                </div>
              );
            }
            return (
              <div key={i} className="output-tree__row output-tree__row--arr-item">
                <span
                  className="output-tree__arr-idx"
                  draggable
                  onDragStart={(e) => handleTreeFieldDrag(e, itemPath)}
                  title={`Drag: {{${itemPath}}}`}
                >[{i}]</span>
                <PrimitiveValue value={item} />
              </div>
            );
          })}
          {hasMore && <div className="output-tree__more">{t("workflows.more_items", { n: String(arr.length - MAX_ARRAY_PREVIEW) })}</div>}
        </>
      )}
    </div>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="output-tree__prim output-tree__prim--null">null</span>;
  if (typeof value === "boolean") return <span className="output-tree__prim output-tree__prim--bool">{String(value)}</span>;
  if (typeof value === "number") return <span className="output-tree__prim output-tree__prim--num">{String(value)}</span>;
  const str = String(value);
  if (str.length > 200) {
    return <span className="output-tree__prim output-tree__prim--str" title={str}>"{str.slice(0, 200)}..."</span>;
  }
  return <span className="output-tree__prim output-tree__prim--str">"{str}"</span>;
}

function format_value(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); }
  catch { return String(v); }
}

function format_time(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}
