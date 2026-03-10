import { BuilderField, BuilderRowPair } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const ACTIONS = ["class_diagram", "sequence_diagram", "call_graph", "dependency_graph", "er_diagram"];
const DIRECTIONS = ["LR", "TB", "RL", "BT"];

function CodeDiagramEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "class_diagram");
  const is_sequence = action === "sequence_diagram";
  return (
    <>
      {!is_sequence ? (
        <BuilderRowPair>
          <BuilderField label={t("workflows.action")} required>
            <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </BuilderField>
          <BuilderField label={t("workflows.code_diagram_direction")}>
            <select className="input input--sm" value={String(node.direction || "LR")} onChange={(e) => update({ direction: e.target.value })}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </BuilderField>
        </BuilderRowPair>
      ) : (
        <BuilderField label={t("workflows.action")} required>
          <select autoFocus className="input input--sm" required value={action} onChange={(e) => update({ action: e.target.value })} aria-required="true">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </BuilderField>
      )}
      {!is_sequence ? (
        <BuilderField label={t("workflows.code_diagram_source")} required>
          <textarea className="input" required rows={5} value={String(node.source || "")} onChange={(e) => update({ source: e.target.value })} placeholder="// Paste source code here" aria-required="true" />
        </BuilderField>
      ) : (
        <>
          <BuilderField label={t("workflows.code_diagram_actors")}>
            <input className="input input--sm" value={String(node.actors || "")} onChange={(e) => update({ actors: e.target.value })} placeholder="Alice, Bob, Server" />
          </BuilderField>
          <BuilderField label={t("workflows.code_diagram_messages")} required>
            <textarea className="input" required rows={4} value={String(node.messages || "")} onChange={(e) => update({ messages: e.target.value })} placeholder='[{"from":"Alice","to":"Bob","msg":"Hello"}]' aria-required="true" />
          </BuilderField>
        </>
      )}
      {!is_sequence && (
        <BuilderRowPair>
          <div className="builder-row">
            <label className="label-inline">
              <input type="checkbox" checked={Boolean(node.show_private)} onChange={(e) => update({ show_private: e.target.checked })} />
              {t("workflows.code_diagram_show_private")}
            </label>
          </div>
          <div className="builder-row">
            <label className="label-inline">
              <input type="checkbox" checked={Boolean(node.group_by_folder)} onChange={(e) => update({ group_by_folder: e.target.checked })} />
              {t("workflows.code_diagram_group_by_folder")}
            </label>
          </div>
        </BuilderRowPair>
      )}
    </>
  );
}

export const code_diagram_descriptor: FrontendNodeDescriptor = {
  node_type: "code_diagram",
  icon: "📊",
  color: "#6a1b9a",
  shape: "rect",
  toolbar_label: "node.code_diagram.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "object", description: "node.code_diagram.output.result" },
    { name: "success", type: "boolean", description: "node.code_diagram.output.success" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.code_diagram.input.action" },
    { name: "source", type: "string", description: "node.code_diagram.input.source" },
  ],
  create_default: () => ({ action: "class_diagram", source: "", direction: "LR", show_private: false, group_by_folder: false }),
  EditPanel: CodeDiagramEditPanel,
};
