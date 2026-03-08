import { BuilderField } from "../builder-field";
import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

function PhoneEditPanel({ node, update, t }: EditPanelProps) {
  return (
    <BuilderField label={t("node.phone.description")} hint={t("node.phone.hint")}>
      {null}
    </BuilderField>
  );
}

export const phone_descriptor: FrontendNodeDescriptor = {
  node_type: "phone",
  icon: "☎️",
  color: "#0288d1",
  shape: "rect",
  toolbar_label: "node.phone.label",
  category: "data",
  output_schema: [
    { name: "result", type: "string", description: "node.phone.output.result" },
    { name: "success", type: "boolean", description: "node.phone.output.success" },
  ],
  input_schema: [
    { name: "data", type: "string", description: "node.phone.input.data" },
  ],
  create_default: () => ({}),
  EditPanel: PhoneEditPanel,
};
