import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function StateMachineEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.state_machine.description")}</label>
        <p className="builder-hint">{t("node.state_machine.hint")}</p>
      </div>
    </>
  );
}

export const state_machine_descriptor: FrontendNodeDescriptor = {
  node_type: "state_machine",
  icon: "🔄",
  color: "#00695c",
  shape: "rect",
  toolbar_label: "node.state_machine.label",
  category: "advanced",
  output_schema: [
    { name: "result", type: "string", description: "node.state_machine.output.result" },
    { name: "success", type: "boolean", description: "node.state_machine.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.state_machine.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: StateMachineEditPanel,
};
