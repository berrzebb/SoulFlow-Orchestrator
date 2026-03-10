import { useEffect, useRef, useState } from "react";
import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function DiagramPreview({ source, format }: { source: string; format: string }) {
  const [preview, setPreview] = useState<{ svg?: string; ascii?: string; error?: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!source.trim()) { setPreview(null); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/workflow/diagram/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source, format }),
        });
        const data = await res.json() as { ok: boolean; output?: string; error?: string };
        if (data.ok && data.output) {
          setPreview(format === "ascii" ? { ascii: data.output } : { svg: data.output });
        } else {
          setPreview({ error: data.error ?? "render_failed" });
        }
      } catch {
        setPreview({ error: "network_error" });
      }
    }, 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [source, format]);

  if (!preview) return null;
  if (preview.error) return <div className="diagram-preview diagram-preview--error">{preview.error}</div>;
  if (preview.ascii) return <pre className="diagram-preview diagram-preview--ascii">{preview.ascii}</pre>;
  if (preview.svg) return <div className="diagram-preview" dangerouslySetInnerHTML={{ __html: preview.svg }} />;
  return null;
}

function DiagramEditPanel({ node, update, t }: EditPanelProps) {
  const format = String(node.output_format || "svg");
  return (
    <>
      <BuilderField label={t("node.diagram.input.source")} hint={t("workflows.diagram_source_hint")}>
        <textarea autoFocus className="input code-textarea" rows={6} value={String(node.source || "")} onChange={(e) => update({ source: e.target.value })} placeholder={"graph TD\n  A[Start] --> B[End]"} />
      </BuilderField>
      <BuilderField label={t("node.diagram.input.type")}>
        <select className="input input--sm" value={String(node.type || "mermaid")} onChange={(e) => update({ type: e.target.value })}>
          <option value="mermaid">Mermaid</option>
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.diagram_output_format")}>
        <select className="input input--sm" value={format} onChange={(e) => update({ output_format: e.target.value })}>
          <option value="svg">SVG</option>
          <option value="ascii">ASCII</option>
        </select>
      </BuilderField>
      <DiagramPreview source={String(node.source || "")} format={format} />
    </>
  );
}

export const diagram_descriptor: FrontendNodeDescriptor = {
  node_type: "diagram",
  icon: "📊",
  color: "#00897b",
  shape: "rect",
  toolbar_label: "node.diagram.label",
  category: "advanced",
  output_schema: [
    { name: "output", type: "string", description: "node.diagram.output.output" },
    { name: "format", type: "string", description: "node.diagram.output.format" },
    { name: "success", type: "boolean", description: "node.diagram.output.success" },
  ],
  input_schema: [
    { name: "source",        type: "string", description: "node.diagram.input.source" },
    { name: "type",          type: "string", description: "node.diagram.input.type" },
    { name: "output_format", type: "string", description: "node.diagram.input.output_format" },
  ],
  create_default: () => ({ source: "", type: "mermaid", output_format: "svg" }),
  EditPanel: DiagramEditPanel,
};
