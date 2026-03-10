import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

const DATA_OPS = ["convert", "query", "validate", "pretty", "flatten", "unflatten", "merge", "pick", "omit"];
const MIME_OPS = ["mime_lookup", "mime_detect", "mime_parse", "mime_reverse"];
const HEADER_OPS = ["header_parse", "header_content_type", "header_cache_control", "header_authorization", "header_content_disposition"];

function DataFormatEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "convert");
  const is_mime = MIME_OPS.includes(op);
  const is_header = HEADER_OPS.includes(op);
  const is_data = DATA_OPS.includes(op);
  return (
    <>
      {op === "convert" ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.operation")} required>
            <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
              <optgroup label="Data Format">{DATA_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>
              <optgroup label="MIME">{MIME_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>
              <optgroup label="HTTP Header">{HEADER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.from_format")}>
            <select className="input input--sm" value={String(node.from || "json")} onChange={(e) => update({ from: e.target.value })}>
              {["json", "csv", "yaml", "toml"].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.operation")} required>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            <optgroup label="Data Format">{DATA_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>
            <optgroup label="MIME">{MIME_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>
            <optgroup label="HTTP Header">{HEADER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>
          </select>
        </BuilderField>
      )}
      {op === "convert" && (
        <BuilderField label={t("workflows.to_format")}>
          <select className="input input--sm" value={String(node.to || "csv")} onChange={(e) => update({ to: e.target.value })}>
            {["json", "csv", "yaml", "toml"].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </BuilderField>
      )}
      {is_data && (
        <BuilderField label={t("workflows.input_data")}>
          <textarea className="input code-textarea" rows={5} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder='{"key": "value"}' />
        </BuilderField>
      )}
      {op === "query" && (
        <BuilderField label={t("workflows.field_json_path")}>
          <input className="input input--sm" value={String(node.path || "")} onChange={(e) => update({ path: e.target.value })} placeholder="$.users[0].name" />
        </BuilderField>
      )}
      {(op === "pick" || op === "omit") && (
        <BuilderField label={t("workflows.keys")}>
          <input className="input input--sm" value={String(node.keys || "")} onChange={(e) => update({ keys: e.target.value })} placeholder="name, email, age" />
        </BuilderField>
      )}
      {op === "merge" && (
        <BuilderField label={t("workflows.input_data_n", { n: 2 })}>
          <textarea className="input code-textarea" rows={3} value={String(node.input2 || "")} onChange={(e) => update({ input2: e.target.value })} placeholder='{"extra": true}' />
        </BuilderField>
      )}
      {is_mime && (
        <>
          {(op === "mime_lookup") && (
            <BuilderField label={t("workflows.mime_extension")} hint={t("workflows.mime_extension_hint")}>
              <input className="input input--sm" value={String(node.mime_extension || "")} onChange={(e) => update({ mime_extension: e.target.value })} placeholder=".pdf" />
            </BuilderField>
          )}
          {(op === "mime_detect" || op === "mime_parse") && (
            <BuilderField label={t("workflows.mime_filename")}>
              <input className="input input--sm" value={String(node.mime_filename || "")} onChange={(e) => update({ mime_filename: e.target.value })} placeholder="document.pdf" />
            </BuilderField>
          )}
          {op === "mime_reverse" && (
            <BuilderField label={t("workflows.mime_extension")} hint={t("workflows.mime_reverse_hint")}>
              <input className="input input--sm" value={String(node.mime_extension || "")} onChange={(e) => update({ mime_extension: e.target.value })} placeholder="application/pdf" />
            </BuilderField>
          )}
        </>
      )}
      {is_header && (
        <>
          {op === "header_parse" && (
            <BuilderField label={t("workflows.header_input")}>
              <textarea className="input code-textarea" rows={3} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="Content-Type: application/json&#10;Authorization: Bearer token" />
            </BuilderField>
          )}
          {op === "header_content_type" && (
            <BuilderField label={t("workflows.header_type")}>
              <input className="input input--sm" value={String(node.header_type || "")} onChange={(e) => update({ header_type: e.target.value })} placeholder="application/json" />
            </BuilderField>
          )}
          {op === "header_authorization" && (
            <BuilderField label={t("workflows.header_token")}>
              <input className="input input--sm" value={String(node.header_token || "")} onChange={(e) => update({ header_token: e.target.value })} placeholder="Bearer my-token" />
            </BuilderField>
          )}
          {op === "header_content_disposition" && (
            <BuilderField label={t("workflows.header_filename")}>
              <input className="input input--sm" value={String(node.header_filename || "")} onChange={(e) => update({ header_filename: e.target.value })} placeholder="report.pdf" />
            </BuilderField>
          )}
          {op === "header_cache_control" && (
            <BuilderField label={t("workflows.header_directives")} hint={t("workflows.header_directives_hint")}>
              <input className="input input--sm" value={String(node.header_directives || "")} onChange={(e) => update({ header_directives: e.target.value })} placeholder="max-age=3600, no-cache" />
            </BuilderField>
          )}
        </>
      )}
    </>
  );
}

export const data_format_descriptor: FrontendNodeDescriptor = {
  node_type: "data_format",
  icon: "\u{1F504}",
  color: "#00838f",
  shape: "rect",
  toolbar_label: "node.data_format.label",
  category: "data",
  output_schema: [
    { name: "result",  type: "string",  description: "node.data_format.output.result" },
    { name: "success", type: "boolean", description: "node.data_format.output.success" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.data_format.input.operation" },
    { name: "input",     type: "string", description: "node.data_format.input.input" },
    { name: "from",      type: "string", description: "node.data_format.input.from" },
    { name: "to",        type: "string", description: "node.data_format.input.to" },
  ],
  create_default: () => ({ operation: "convert", input: "", from: "json", to: "csv", path: "", keys: "", input2: "", delimiter: ",", mime_extension: "", mime_filename: "", header_type: "", header_token: "", header_filename: "", header_directives: "" }),
  EditPanel: DataFormatEditPanel,
};
