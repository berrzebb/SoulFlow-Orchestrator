import type { FrontendNodeDescriptor, EditPanelProps } from "../node-registry";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript (VM)" },
  { value: "shell",      label: "Shell" },
  { value: "python",     label: "Python 🐳" },
  { value: "bash",       label: "Bash 🐳" },
  { value: "ruby",       label: "Ruby 🐳" },
  { value: "go",         label: "Go 🐳" },
  { value: "rust",       label: "Rust 🐳" },
  { value: "deno",       label: "Deno 🐳" },
  { value: "bun",        label: "Bun 🐳" },
] as const;

const CONTAINER_LANGS = new Set(["python", "bash", "ruby", "go", "rust", "deno", "bun"]);

function CodeEditPanel({ node, update, t }: EditPanelProps) {
  const lang = String(node.language || "javascript");
  const is_container = CONTAINER_LANGS.has(lang);

  return (
    <>
      <div className="builder-row">
        <label className="label">{t("workflows.code_language")}</label>
        <select className="input input--sm" value={lang} onChange={(e) => update({ language: e.target.value })}>
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>
      <div className="builder-row">
        <label className="label">Code <span className="builder-hint--inline">({lang})</span></label>
        <textarea className="input code-textarea" rows={14} value={String(node.code || "")} onChange={(e) => update({ code: e.target.value })} spellCheck={false} style={{ resize: "vertical", minHeight: 160 }} />
      </div>
      {is_container && (
        <>
          <div className="builder-row">
            <label className="label">{t("workflows.container_image_override")}</label>
            <input className="input input--sm" placeholder="e.g. python:3.11-slim" value={String(node.container_image || "")} onChange={(e) => update({ container_image: e.target.value || undefined })} />
          </div>
          <div className="builder-row" style={{ display: "flex", gap: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <input type="checkbox" checked={!!node.network_access} onChange={(e) => update({ network_access: e.target.checked })} />
              {t("workflows.network_access")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <input type="checkbox" checked={!!node.keep_container} onChange={(e) => update({ keep_container: e.target.checked })} />
              {t("workflows.keep_container")}
            </label>
          </div>
        </>
      )}
    </>
  );
}

export const code_descriptor: FrontendNodeDescriptor = {
  node_type: "code",
  icon: "</>",
  color: "#2ecc71",
  shape: "rect",
  toolbar_label: "+ Code",
  output_schema: [
    { name: "result", type: "unknown", description: "Return value / stdout" },
    { name: "logs",   type: "array",   description: "Console output" },
  ],
  input_schema: [
    { name: "input", type: "object", description: "Code input data" },
  ],
  create_default: () => ({ language: "javascript", code: "" }),
  EditPanel: CodeEditPanel,
};
