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
        <input className="input input--sm" required value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="/path/to/document.pdf" aria-required="true" />
      </BuilderField>
      {action === "extract_text" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.pdf_pages")}>
            <input className="input input--sm" value={String(node.pages || "")} onChange={(e) => update({ pages: e.target.value || undefined })} placeholder="1-3 (empty = all)" />
          </BuilderField>
          <BuilderField label={t("workflows.pdf_max_chars")}>
            <input className="input input--sm" type="number" min={1} value={String(node.max_chars ?? "")} onChange={(e) => update({ max_chars: e.target.value ? Number(e.target.value) : undefined })} placeholder="unlimited" />
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
    { name: "path", type: "string", description: "node.pdf.input.path" },
  ],
  create_default: () => ({ action: "extract_text", path: "" }),
  EditPanel: PdfEditPanel,
};
