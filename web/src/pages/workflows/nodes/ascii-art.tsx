import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const ASCII_ACTIONS = ["banner", "figlet", "box", "line", "table", "border"] as const;
const BOX_STYLES = ["single", "double", "round", "heavy"] as const;

function AsciiArtEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "banner");
  const needs_text = ["banner", "figlet", "box", "border"].includes(action);
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {ASCII_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </BuilderField>
      {needs_text && (
        <BuilderField label={t("workflows.ascii_art_text")} required>
          <input className="input" value={String(node.text || "")} onChange={(e) => update({ text: e.target.value })} placeholder="HELLO" />
        </BuilderField>
      )}
      {action === "box" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.ascii_art_style")}>
            <select className="input input--sm" value={String(node.style || "single")} onChange={(e) => update({ style: e.target.value })}>
              {BOX_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.ascii_art_padding")}>
            <input className="input input--sm" type="number" min={0} value={String(node.padding ?? 1)} onChange={(e) => update({ padding: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {(action === "line" || action === "border") && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.ascii_art_char")}>
            <input className="input input--sm" value={String(node.char || "-")} onChange={(e) => update({ char: e.target.value })} placeholder="-" />
          </BuilderField>
          <BuilderField label={t("workflows.ascii_art_width")}>
            <input className="input input--sm" type="number" min={1} value={String(node.width ?? 60)} onChange={(e) => update({ width: Number(e.target.value) })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {action === "table" && (
        <>
          <BuilderField label={t("workflows.ascii_art_headers")} hint={t("workflows.ascii_art_headers_hint")}>
            <input className="input input--sm" value={String(node.headers || "")} onChange={(e) => update({ headers: e.target.value })} placeholder='["Name","Age","City"]' />
          </BuilderField>
          <BuilderField label={t("workflows.ascii_art_data")} required hint={t("workflows.ascii_art_data_hint")}>
            <textarea className="input code-textarea" rows={4} value={String(node.data || "")} onChange={(e) => update({ data: e.target.value })} placeholder={'[["Alice","30","Seoul"],["Bob","25","Busan"]]'} />
          </BuilderField>
        </>
      )}
    </>
  );
}

export const ascii_art_descriptor: FrontendNodeDescriptor = {
  node_type: "ascii_art",
  icon: "\u{1F3A8}",
  color: "#4a148c",
  shape: "rect",
  toolbar_label: "node.ascii_art.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.ascii_art.output.result" },
    { name: "success", type: "boolean", description: "node.ascii_art.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.ascii_art.input.action" },
    { name: "text",   type: "string", description: "node.ascii_art.input.text" },
  ],
  create_default: () => ({
    action: "banner", text: "", char: "-", width: 60, padding: 1, style: "single", data: "", headers: "",
  }),
  EditPanel: AsciiArtEditPanel,
};
