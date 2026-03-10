import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function FormatEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "number");
  return (
    <>
      <BuilderField label={t("workflows.operation")} required>
        <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
          {["number", "currency", "percent", "bytes", "relative_time", "mask", "ordinal", "plural", "duration", "pad", "truncate"].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </BuilderField>
      <BuilderField label={t("workflows.field_value")}>
        <input className="input" value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder={op === "bytes" ? "1073741824" : "12345.67"} />
      </BuilderField>
      {["number", "currency", "percent"].includes(op) && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_locale")}>
            <input className="input input--sm" value={String(node.locale || "en-US")} onChange={(e) => update({ locale: e.target.value })} />
          </BuilderField>
          <BuilderField label={t("workflows.field_decimals")}>
            <input className="input input--sm" type="number" min={0} max={10} value={String(node.decimals ?? 2)} onChange={(e) => update({ decimals: Number(e.target.value) || 0 })} />
          </BuilderField>
        </BuilderRowPair>
      )}
      {op === "currency" && (
        <BuilderField label={t("workflows.field_currency")}>
          <input className="input input--sm" value={String(node.currency || "USD")} onChange={(e) => update({ currency: e.target.value })} placeholder="USD" />
        </BuilderField>
      )}
      {op === "mask" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_mask_type")}>
            <select className="input input--sm" value={String(node.mask_type || "custom")} onChange={(e) => update({ mask_type: e.target.value })}>
              {["email", "phone", "card", "custom"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.format_mask_char")}>
            <input className="input input--sm" value={String(node.mask_char || "*")} onChange={(e) => update({ mask_char: e.target.value || "*" })} placeholder="*" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {op === "plural" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.format_word")}>
            <input className="input input--sm" value={String(node.word || "")} onChange={(e) => update({ word: e.target.value })} placeholder="item" />
          </BuilderField>
          <BuilderField label={t("workflows.format_word_plural")}>
            <input className="input input--sm" value={String(node.plural_word || "")} onChange={(e) => update({ plural_word: e.target.value })} placeholder="items" />
          </BuilderField>
        </BuilderRowPair>
      )}
      {op === "pad" && (
        <>
          <BuilderRowPair>
            <BuilderField label={t("workflows.field_width")}>
              <input className="input input--sm" type="number" min={1} value={String(node.width ?? 10)} onChange={(e) => update({ width: Number(e.target.value) || 10 })} />
            </BuilderField>
            <BuilderField label={t("workflows.field_align")}>
              <select className="input input--sm" value={String(node.align || "right")} onChange={(e) => update({ align: e.target.value })}>
                <option value="right">right</option>
                <option value="left">left</option>
                <option value="center">center</option>
              </select>
            </BuilderField>
          </BuilderRowPair>
          <BuilderField label={t("workflows.format_fill_char")}>
            <input className="input input--sm" value={String(node.fill || " ")} onChange={(e) => update({ fill: e.target.value || " " })} placeholder=" " />
          </BuilderField>
        </>
      )}
      {op === "truncate" && (
        <BuilderRowPair>
          <BuilderField label={t("workflows.field_max_length")}>
            <input className="input input--sm" type="number" min={1} value={String(node.max_length ?? 50)} onChange={(e) => update({ max_length: Number(e.target.value) })} />
          </BuilderField>
          <BuilderField label={t("workflows.format_suffix")}>
            <input className="input input--sm" value={String(node.suffix || "...")} onChange={(e) => update({ suffix: e.target.value })} placeholder="..." />
          </BuilderField>
        </BuilderRowPair>
      )}
    </>
  );
}

export const format_descriptor: FrontendNodeDescriptor = {
  node_type: "format",
  icon: "🎯",
  color: "#00838f",
  shape: "rect",
  toolbar_label: "node.format.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.format.output.result" },
    { name: "success", type: "boolean", description: "node.format.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.format.input.operation" },
    { name: "value",     type: "string", description: "node.format.input.value" },
  ],
  create_default: () => ({ operation: "number", value: "", locale: "en-US", currency: "USD", decimals: 2, mask_type: "custom", mask_char: "*", max_length: 50, suffix: "...", width: 10, fill: " ", align: "right", word: "", plural_word: "" }),
  EditPanel: FormatEditPanel,
};
