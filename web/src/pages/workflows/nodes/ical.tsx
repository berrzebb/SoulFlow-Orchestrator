import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { BuilderField } from "../builder-field";

const ICAL_ACTIONS = ["generate", "parse", "add_event", "validate"] as const;

function IcalEditPanel({ node, update, t }: EditPanelProps) {
  const action = String(node.action || "generate");
  return (
    <>
      <BuilderField label={t("workflows.action")} required>
        <select autoFocus className="input input--sm" value={action} onChange={(e) => update({ action: e.target.value })}>
          {ICAL_ACTIONS.map((a) => <option key={a} value={a}>{t(`node.action.${a}`)}</option>)}
        </select>
      </BuilderField>
      {(action === "generate") && (
        <>
          <BuilderField label={t("workflows.ical_calendar_name")}>
            <input className="input" value={String(node.calendar_name || "Calendar")} onChange={(e) => update({ calendar_name: e.target.value })} placeholder="My Calendar" />
          </BuilderField>
          <BuilderField label={t("workflows.ical_events")} required hint={t("workflows.ical_events_hint")}>
            <textarea className="input" rows={5} value={String(node.events || "")} onChange={(e) => update({ events: e.target.value })} placeholder='[{"summary":"Meeting","start":"2024-01-15T10:00:00","end":"2024-01-15T11:00:00"}]' />
          </BuilderField>
        </>
      )}
      {action === "add_event" && (
        <>
          <BuilderField label={t("workflows.ical_input")} required hint={t("workflows.ical_input_hint")}>
            <textarea className="input" rows={4} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="BEGIN:VCALENDAR..." />
          </BuilderField>
          <BuilderField label={t("workflows.ical_event")} required hint={t("workflows.ical_events_hint")}>
            <textarea className="input" rows={4} value={String(node.event || "")} onChange={(e) => update({ event: e.target.value })} placeholder='{"summary":"New Event","start":"2024-01-20T09:00:00"}' />
          </BuilderField>
        </>
      )}
      {(action === "parse" || action === "validate") && (
        <BuilderField label={t("workflows.ical_input")} required hint={t("workflows.ical_input_hint")}>
          <textarea className="input" rows={6} value={String(node.input || "")} onChange={(e) => update({ input: e.target.value })} placeholder="BEGIN:VCALENDAR..." />
        </BuilderField>
      )}
    </>
  );
}

export const ical_descriptor: FrontendNodeDescriptor = {
  node_type: "ical",
  icon: "\u{1F4C5}",
  color: "#00838f",
  shape: "rect",
  toolbar_label: "node.ical.label",
  category: "data",
  output_schema: [
    { name: "ics",    type: "string",  description: "node.ical.output.ics" },
    { name: "events", type: "array",   description: "node.ical.output.events" },
    { name: "valid",  type: "boolean", description: "node.ical.output.valid" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "node.ical.input.action" },
    { name: "events", type: "string", description: "node.ical.input.events" },
    { name: "input",  type: "string", description: "node.ical.input.input" },
  ],
  create_default: () => ({ action: "generate", events: "", event: "", input: "", calendar_name: "Calendar" }),
  EditPanel: IcalEditPanel,
};
