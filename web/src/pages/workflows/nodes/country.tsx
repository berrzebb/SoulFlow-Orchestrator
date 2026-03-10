import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const COUNTRY_ACTIONS = ["lookup", "search", "by_dial_code", "by_currency", "by_continent", "list"] as const;

function CountryEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "lookup");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {COUNTRY_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {action === "lookup" && (
        <BuilderField label={t("workflows.country_code")} required>
          <input className="input" value={String(node.code || "")} onChange={(e) => update({ code: e.target.value })} placeholder="KR or KOR" />
        </BuilderField>
      )}
      {action === "search" && (
        <BuilderField label={t("workflows.field_query")} required>
          <input className="input" value={String(node.query || "")} onChange={(e) => update({ query: e.target.value })} placeholder="Korea" />
        </BuilderField>
      )}
      {action === "by_dial_code" && (
        <BuilderField label={t("workflows.country_dial_code")} required>
          <input className="input" value={String(node.dial_code || "")} onChange={(e) => update({ dial_code: e.target.value })} placeholder="+82" />
        </BuilderField>
      )}
      {action === "by_currency" && (
        <BuilderField label={t("workflows.country_currency")} required>
          <input className="input" value={String(node.currency || "")} onChange={(e) => update({ currency: e.target.value })} placeholder="KRW" />
        </BuilderField>
      )}
      {action === "by_continent" && (
        <BuilderField label={t("workflows.country_continent")} required>
          <select className="input input--sm" value={String(node.continent || "")} onChange={(e) => update({ continent: e.target.value })}>
            <option value="">-- select --</option>
            {[["Asia","asia"],["Europe","europe"],["North America","north_america"],["South America","south_america"],["Africa","africa"],["Oceania","oceania"]].map(([v,k]) => <option key={v} value={v}>{t(`node.continent.${k}`)}</option>)}
          </select>
        </BuilderField>
      )}
    </>
  );
}

export const country_descriptor: FrontendNodeDescriptor = {
  node_type: "country",
  icon: "\u{1F30D}",
  color: "#1565c0",
  shape: "rect",
  toolbar_label: "node.country.label",
  category: "data",
  output_schema: [
    { name: "name",     type: "string", description: "node.country.output.name" },
    { name: "code",     type: "string", description: "node.country.output.code" },
    { name: "dial",     type: "string", description: "node.country.output.dial" },
    { name: "currency", type: "string", description: "node.country.output.currency" },
    { name: "results",  type: "array",  description: "node.country.output.results" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.country.input.action" },
    { name: "code",   type: "string", description: "node.country.input.code" },
  ],
  create_default: () => ({ action: "lookup", code: "", query: "", dial_code: "", currency: "", continent: "" }),
  EditPanel: CountryEditPanel,
};
