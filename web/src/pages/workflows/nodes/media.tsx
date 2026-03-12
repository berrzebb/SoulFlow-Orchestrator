import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const OPERATIONS = ["detect_type", "extract_metadata", "to_base64", "from_base64"] as const;

function MediaEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "detect_type");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {OPERATIONS.map((o) => <option key={o} value={o}>{t(`node.media.op.${o}`)}</option>)}
        </select>
      </BuilderField>
      {op !== "from_base64" && (
        <BuilderField label={t("node.media.input_path")}>
          <input className="input input--sm inspector-droppable" value={String(node.input_path || "")}
            onChange={(e) => update({ input_path: e.target.value })}
            placeholder="/path/to/file"
            data-droppable="true"
          />
        </BuilderField>
      )}
      {op === "from_base64" && (
        <>
          <BuilderField label={t("node.media.base64_input")}>
            <textarea className="input inspector-droppable" rows={3}
              value={String(node.input_path || "")}
              onChange={(e) => update({ input_path: e.target.value })}
              placeholder="data:image/png;base64,... or {{prev_node.result}}"
              data-droppable="true"
            />
          </BuilderField>
          <BuilderField label={t("node.media.output_path")}>
            <input className="input input--sm" value={String(node.output_path || "")}
              onChange={(e) => update({ output_path: e.target.value })}
              placeholder="output/file.png"
            />
          </BuilderField>
        </>
      )}
{op === "to_base64" && (
        <BuilderField label={t("node.media.mime_override")}>
          <input className="input input--sm" value={String(node.mime_type || "")}
            onChange={(e) => update({ mime_type: e.target.value })}
            placeholder="auto-detect"
          />
        </BuilderField>
      )}
    </>
  );
}

export const media_descriptor: FrontendNodeDescriptor = {
  node_type: "media",
  icon: "\u{1F3AC}",
  color: "#8e44ad",
  shape: "rect",
  toolbar_label: "node.media.label",
  category: "data",
  output_schema: [
    { name: "mime_type", type: "string",  description: "node.media.output.mime_type" },
    { name: "category",  type: "string",  description: "node.media.output.category" },
    { name: "metadata",  type: "object",  description: "node.media.output.metadata" },
    { name: "result",    type: "string",  description: "node.media.output.result" },
    { name: "success",   type: "boolean", description: "node.media.output.success" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "node.media.input.operation" },
    { name: "input_path", type: "string", description: "node.media.input.input_path" },
  ],
  create_default: () => ({ operation: "detect_type", input_path: "", output_path: "", mime_type: "" }),
  EditPanel: MediaEditPanel,
};
