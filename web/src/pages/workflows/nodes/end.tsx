import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";
import { END_TARGET_PARAMS } from "../output-schema";

const OUTPUT_TARGETS = [
  { value: "channel", label: "node.end.target.channel", icon: "💬" },
  { value: "media", label: "node.end.target.media", icon: "🎬" },
  { value: "webhook", label: "node.end.target.webhook", icon: "🪝" },
  { value: "http", label: "node.end.target.http", icon: "🌐" },
] as const;

function EndEditPanel({ node, update, t }: EditPanelProps) {
  const targets = (node.output_targets as string[]) || [];
  const config = (node.target_config as Record<string, Record<string, unknown>>) || {};

  const toggle = (value: string) => {
    const next = targets.includes(value)
      ? targets.filter((v) => v !== value)
      : [...targets, value];
    update({ output_targets: next });
  };

  const updateConfig = (target: string, key: string, value: unknown) => {
    const prev = config[target] || {};
    update({ target_config: { ...config, [target]: { ...prev, [key]: value } } });
  };

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("node.end.select_targets")}</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {OUTPUT_TARGETS.map(({ value, label, icon }) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "var(--fs-sm)" }}>
              <input
                type="checkbox"
                checked={targets.includes(value)}
                onChange={() => toggle(value)}
              />
              <span>{icon}</span>
              <span>{t(label)}</span>
            </label>
          ))}
        </div>
      </div>

      {targets.map((target) => {
        const params = END_TARGET_PARAMS[target];
        if (!params || params.length === 0) return null;
        const targetConfig = config[target] || {};
        const targetInfo = OUTPUT_TARGETS.find((o) => o.value === target);
        return (
          <div key={target} style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
            <label className="label">{targetInfo?.icon} {t(`node.end.target.${target}`)}</label>
            {params.map((param) => {
              const fieldKey = param.name.split(".")[1]!;
              const isRequired = ["message", "url", "status", "data"].includes(fieldKey);
              return (
                <div className="builder-row" key={param.name} style={{ marginTop: 4 }}>
                  <label className="label" style={{ fontSize: "var(--fs-xs)", textTransform: "none" }}>
                    {t(param.description || fieldKey)}
                    {isRequired && <span className="label__required">*</span>}
                  </label>
                  <input
                    className="input input--sm inspector-droppable"
                    required={isRequired}
                    value={String(targetConfig[fieldKey] ?? "")}
                    onChange={(e) => updateConfig(target, fieldKey, e.target.value)}
                    placeholder={`{{prev.result}} or value`}
                    data-droppable="true"
                    aria-required={isRequired}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

export const end_descriptor: FrontendNodeDescriptor = {
  node_type: "end",
  icon: "\u23F9",
  color: "#e74c3c",
  shape: "rect",
  toolbar_label: "node.end.label",
  category: "flow",
  output_schema: [],
  input_schema: [
    { name: "result", type: "any", description: "node.end.input.result" },
  ],
  create_default: () => ({ output_targets: [], target_config: {} }),
  EditPanel: EndEditPanel,
};
