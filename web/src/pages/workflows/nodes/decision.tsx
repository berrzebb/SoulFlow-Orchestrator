import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField, BuilderRowPair } from "../builder-field";

function DecisionEditPanel({ node, update, t }: EditPanelProps) {
  const op = String(node.operation || "append");
  return (
    <>
      <BuilderRowPair>
        <BuilderField label={t("workflows.decision_op")}>
          <select autoFocus className="input input--sm" value={op} onChange={(e) => update({ operation: e.target.value })}>
            <option value="append">{t("workflows.opt_append")}</option>
            <option value="list">{t("workflows.opt_list")}</option>
            <option value="get_effective">{t("workflows.opt_get_effective")}</option>
            <option value="archive">{t("workflows.opt_archive")}</option>
          </select>
        </BuilderField>
        <BuilderField label={t("workflows.decision_scope")}>
          <select className="input input--sm" value={String(node.scope || "global")} onChange={(e) => update({ scope: e.target.value })}>
            <option value="global">{t("workflows.opt_global")}</option>
            <option value="team">{t("workflows.opt_team")}</option>
            <option value="agent">{t("workflows.opt_agent")}</option>
          </select>
        </BuilderField>
      </BuilderRowPair>
      {(op === "append") && (
        <>
          <BuilderField label={t("workflows.decision_key")}>
            <input className="input input--sm" value={String(node.key || "")} onChange={(e) => update({ key: e.target.value })} placeholder="coding_style" />
          </BuilderField>
          <BuilderField label={t("workflows.decision_value")}>
            <textarea className="input" rows={2} value={String(node.value || "")} onChange={(e) => update({ value: e.target.value })} placeholder="Always use TypeScript strict mode" />
          </BuilderField>
          <BuilderField label={t("workflows.decision_rationale")}>
            <input className="input input--sm" value={String(node.rationale || "")} onChange={(e) => update({ rationale: e.target.value || undefined })} placeholder="Why this decision was made" />
          </BuilderField>
          <BuilderRowPair>
            <BuilderField label={t("workflows.decision_priority")}>
              <select className="input input--sm" value={String(node.priority ?? 1)} onChange={(e) => update({ priority: Number(e.target.value) })}>
                <option value="0">{t("workflows.opt_p0")}</option>
                <option value="1">{t("workflows.opt_p1")}</option>
                <option value="2">{t("workflows.opt_p2")}</option>
                <option value="3">{t("workflows.opt_p3")}</option>
              </select>
            </BuilderField>
            <BuilderField label={t("workflows.decision_tags")}>
              <input className="input input--sm" value={Array.isArray(node.tags) ? (node.tags as string[]).join(", ") : ""} onChange={(e) => update({ tags: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="style, code" />
            </BuilderField>
          </BuilderRowPair>
        </>
      )}
      {(op === "list" || op === "get_effective") && (
        <BuilderField label={t("workflows.decision_scope_id")}>
          <input className="input input--sm" value={String(node.scope_id || "")} onChange={(e) => update({ scope_id: e.target.value || undefined })} placeholder="team-123" />
        </BuilderField>
      )}
      {op === "archive" && (
        <BuilderField label={t("workflows.decision_target")}>
          <input className="input input--sm" value={String(node.target_id || "")} onChange={(e) => update({ target_id: e.target.value })} placeholder="decision-id-123" />
        </BuilderField>
      )}
    </>
  );
}

export const decision_descriptor: FrontendNodeDescriptor = {
  node_type: "decision",
  icon: "⚖",
  color: "#795548",
  shape: "rect",
  toolbar_label: "node.decision.label",
  category: "advanced",
  output_schema: [
    { name: "action",  type: "string", description: "node.decision.output.action" },
    { name: "record",  type: "object", description: "node.decision.output.record" },
    { name: "records", type: "array",  description: "node.decision.output.records" },
    { name: "count",   type: "number", description: "node.decision.output.count" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "node.decision.input.operation" },
    { name: "key",       type: "string", description: "node.decision.input.key" },
    { name: "value",     type: "string", description: "node.decision.input.value" },
  ],
  create_default: () => ({ operation: "append", scope: "global", key: "", value: "", rationale: "", priority: 1, tags: [], scope_id: "", target_id: "" }),
  EditPanel: DecisionEditPanel,
};
