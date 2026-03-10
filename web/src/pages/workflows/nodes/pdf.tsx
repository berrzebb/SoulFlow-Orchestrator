import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["extract_text", "info", "page_count"];

function PdfEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "extract_text");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      </BuilderRowPair>
      <BuilderField label={t("workflows.file_path")} required>
        <input className="input input--sm" required value={String(node.file_path || "")} onChange={(e) => update({ file_path: e.target.value })} placeholder="/path/to/document.pdf" aria-required="true" />
      </BuilderField>
      {action === "extract_text" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.pdf_start_page")}>
            <input className="input input--sm" type="number" min={1} value={String(node.start_page ?? "")} onChange={(e) => update({ start_page: e.target.value ? Number(e.target.value) : undefined })} placeholder="1" />
          </BuilderField>
          <BuilderField label={t("workflows.pdf_end_page")}>
            <input className="input input--sm" type="number" min={1} value={String(node.end_page ?? "")} onChange={(e) => update({ end_page: e.target.value ? Number(e.target.value) : undefined })} placeholder="all" />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const pdf_descriptor: FrontendNodeDescriptor = {
  node_type: "pdf",
  icon: "📄",
  color: "#e53935",
  shape: "rect",
  toolbar_label: "node.pdf.label",
  category: "integration",
  output_schema: [
    { name: "result", type: "string", description: "node.pdf.output.result" },
    { name: "success", type: "boolean", description: "node.pdf.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.pdf.input.action" },
    { name: "file_path", type: "string", description: "node.pdf.input.file_path" },
  ],
  create_default: () => ({ action: "extract_text", file_path: "" }),
  EditPanel: PdfEditPanel,
};
