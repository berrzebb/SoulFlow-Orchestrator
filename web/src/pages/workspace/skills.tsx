import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { SplitPane } from "./split-pane";

interface SkillInfo { name: string; summary: string; source: string; type: string; always: string; model: string }
interface SkillDetail {
  metadata: {
    name: string; path: string; source: string; type: string; always: boolean; summary: string;
    aliases: string[]; triggers: string[]; tools: string[]; requirements: string[];
    model: string | null; role: string | null; soul: string | null; heart: string | null;
    shared_protocols: string[];
  } | null;
  content: string | null;
  references: Array<{ name: string; content: string }> | null;
}

/** SKILL.md frontmatter에서 특정 목록 필드 파싱 (tools, oauth 등) */
function parse_frontmatter_list(content: string, field: string): string[] {
  const fm_match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm_match || !fm_match[1]) return [];
  const fm: string = fm_match[1];
  // 이스케이프 없이 리터럴 field 이름으로 매칭
  const f = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inline = fm.match(new RegExp(`^\\s*${f}:\\s*\\[([^\\]]*)\\]`, "m"));
  if (inline?.[1] != null) return inline[1].split(",").map((s) => s.trim()).filter(Boolean);
  const list = fm.match(new RegExp(`^\\s*${f}:\\s*\\n((?:[ \\t]+-[ \\t]+\\S[^\\n]*\\n?)+)`, "m"));
  if (list?.[1]) return (list[1].match(/[ \t]+-[ \t]+(\S+)/g) ?? []).map((s) => s.replace(/^[ \t]+-[ \t]+/, "").trim());
  return [];
}

/** SKILL.md frontmatter의 목록 필드 업데이트 (인라인 배열 형식으로 통일) */
function update_frontmatter_list(content: string, field: string, values: string[]): string {
  const fm_match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  const new_line = values.length > 0 ? `  ${field}: [${values.join(", ")}]` : null;
  if (!fm_match || !fm_match[1]) {
    return (new_line ? `---\nmetadata:\n${new_line}\n---\n` : "") + content;
  }
  const fm: string = fm_match[1];
  const after = content.slice(fm_match[0].length);
  let new_fm: string = fm;
  const f = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^\\s*${f}:\\s*\\[[^\\]]*\\]`, "m").test(new_fm)) {
    new_fm = new_line
      ? new_fm.replace(new RegExp(`^\\s*${f}:\\s*\\[[^\\]]*\\]`, "m"), new_line)
      : new_fm.replace(new RegExp(`^\\s*${f}:\\s*\\[[^\\]]*\\]\\n?`, "m"), "");
  } else if (new RegExp(`^\\s*${f}:\\s*\\n(?:[ \\t]+-[ \\t]+\\S[^\\n]*\\n?)+`, "m").test(new_fm)) {
    new_fm = new_line
      ? new_fm.replace(new RegExp(`^\\s*${f}:\\s*\\n((?:[ \\t]+-[ \\t]+\\S[^\\n]*\\n?)+)`, "m"), new_line + "\n")
      : new_fm.replace(new RegExp(`^\\s*${f}:\\s*\\n((?:[ \\t]+-[ \\t]+\\S[^\\n]*\\n?)+)`, "m"), "");
  } else if (new_line) {
    new_fm = /^metadata:/m.test(new_fm)
      ? new_fm.replace(/^(metadata:)/m, `$1\n${new_line}`)
      : new_fm + `\nmetadata:\n${new_line}`;
  }
  return `---\n${new_fm}\n---\n${after}`;
}

const parse_frontmatter_tools = (c: string) => parse_frontmatter_list(c, "tools");
const update_frontmatter_tools = (c: string, v: string[]) => update_frontmatter_list(c, "tools", v);
const parse_frontmatter_oauth = (c: string) => parse_frontmatter_list(c, "oauth");
const update_frontmatter_oauth = (c: string, v: string[]) => update_frontmatter_list(c, "oauth", v);

/** SKILL.md tools + oauth 프론트매터 편집 UI */
function ToolPicker({ content, onChange, all_tools, native_tools, oauth_services, roles }: {
  content: string;
  onChange: (newContent: string) => void;
  all_tools: string[];
  native_tools: string[];
  oauth_services: string[];
  roles: SkillInfo[];
}) {
  const t = useT();
  const [loading_role, setLoadingRole] = useState<string | null>(null);
  const current_tools = parse_frontmatter_tools(content);
  const current_oauth = parse_frontmatter_oauth(content);
  const tools_set = new Set(current_tools);
  const oauth_set = new Set(current_oauth);

  const toggle_tool = (tool: string) => {
    const next = tools_set.has(tool) ? current_tools.filter((x) => x !== tool) : [...current_tools, tool];
    onChange(update_frontmatter_tools(content, next));
  };

  const toggle_oauth = (service: string) => {
    const next = oauth_set.has(service) ? current_oauth.filter((x) => x !== service) : [...current_oauth, service];
    onChange(update_frontmatter_oauth(content, next));
  };

  const add_from_role = async (role_name: string) => {
    setLoadingRole(role_name);
    try {
      const detail: SkillDetail = await api.get(`/api/skills/${encodeURIComponent(role_name)}`);
      const role_tools = detail.metadata?.tools ?? [];
      const merged = Array.from(new Set([...current_tools, ...role_tools]));
      onChange(update_frontmatter_tools(content, merged));
    } finally {
      setLoadingRole(null);
    }
  };

  const chip = (label: string, active: boolean, onClick: () => void, accent = "var(--accent)") => (
    <span
      key={label}
      onClick={onClick}
      style={{
        cursor: "pointer", padding: "1px 7px",
        borderRadius: "var(--radius-pill)", fontSize: 10,
        background: active ? `${accent}22` : "rgba(255,255,255,0.04)",
        color: active ? accent : "var(--muted)",
        border: `1px solid ${active ? `${accent}55` : "transparent"}`,
        userSelect: "none",
      }}
    >
      {label}
    </span>
  );

  if (all_tools.length === 0 && native_tools.length === 0 && oauth_services.length === 0) return null;
  return (
    <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", background: "var(--panel-elevated)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {all_tools.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, marginRight: 2 }}>{t("skills.tools")}:</span>
          {all_tools.map((tool) => chip(tool, tools_set.has(tool), () => toggle_tool(tool)))}
        </div>
      )}
      {native_tools.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--ok)", fontWeight: 600, marginRight: 2 }}>SDK:</span>
          {native_tools.map((tool) => chip(tool, tools_set.has(tool), () => toggle_tool(tool), "var(--ok)"))}
        </div>
      )}
      {oauth_services.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--warn)", fontWeight: 600, marginRight: 2 }}>OAuth:</span>
          {oauth_services.map((svc) => chip(svc, oauth_set.has(svc), () => toggle_oauth(svc), "var(--warn)"))}
        </div>
      )}
      {roles.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, marginRight: 2 }}>{t("skills.from_role")}:</span>
          {roles.map((role) => (
            <button
              key={role.name}
              className="btn btn--xs"
              disabled={loading_role !== null}
              onClick={() => void add_from_role(role.name)}
              style={{ fontSize: 9, padding: "1px 6px" }}
            >
              {loading_role === role.name ? "..." : `+${role.name}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SkillsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState("SKILL.md");
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: skills = [] } = useQuery<SkillInfo[]>({
    queryKey: ["ws-skills"],
    queryFn: () => api.get("/api/skills"),
  });

  const { data: tools_data } = useQuery<{ names: string[]; native_tools?: string[] }>({
    queryKey: ["tools"],
    queryFn: () => api.get("/api/tools"),
    staleTime: 60_000,
  });
  const all_tools = tools_data?.names ?? [];
  const native_tools = tools_data?.native_tools ?? [];

  const { data: oauth_presets = [] } = useQuery<Array<{ service_type: string; label: string }>>({
    queryKey: ["oauth-presets"],
    queryFn: () => api.get("/api/oauth/presets"),
    staleTime: 60_000,
  });
  // "custom" 제외 — 프론트매터에서 특정 서비스 ID로 참조
  const oauth_services = oauth_presets.filter((p) => p.service_type !== "custom").map((p) => p.service_type);

  const { data: detail } = useQuery<SkillDetail>({
    queryKey: ["ws-skill-detail", selected],
    queryFn: () => api.get(`/api/skills/${selected}`),
    enabled: !!selected,
  });

  const refresh = async () => {
    await api.post("/api/skills/refresh");
    toast(t("skills.refreshed"), "ok");
    void qc.invalidateQueries({ queryKey: ["ws-skills"] });
  };

  const handle_import_file = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipFile(file);
    if (!importName) setImportName(file.name.replace(/\.zip$/i, ""));
  };

  const confirm_import = async () => {
    if (!importName.trim() || !zipFile) return;
    setImporting(true);
    try {
      const buf = await zipFile.arrayBuffer();
      const zip_b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      await api.post("/api/skills/import", { name: importName.trim(), zip_b64 });
      toast(t("skills.imported", { name: importName.trim() }), "ok");
      void qc.invalidateQueries({ queryKey: ["ws-skills"] });
      setShowImport(false);
      setImportName("");
      setZipFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      toast(t("common.error" as never) || "Error", "err");
    } finally {
      setImporting(false);
    }
  };

  const is_editable = detail?.metadata
    ? String(detail.metadata.source ?? "").toLowerCase() !== "builtin"
    : false;

  const active_content =
    editContent !== null
      ? editContent
      : activeFile === "SKILL.md"
      ? (detail?.content ?? "")
      : (detail?.references?.find((r) => r.name === activeFile)?.content ?? "");

  const handle_tab_change = (name: string) => {
    setActiveFile(name);
    setEditContent(null); // 탭 전환 시 편집 내용 초기화
  };

  const handle_select = (name: string) => {
    setSelected(name);
    setActiveFile("SKILL.md");
    setEditContent(null);
  };

  const save = async () => {
    if (!selected || editContent === null) return;
    setSaving(true);
    try {
      await api.put(`/api/skills/${encodeURIComponent(selected)}`, { file: activeFile, content: editContent });
      toast(t("skills.saved"), "ok");
      setEditContent(null);
      void qc.invalidateQueries({ queryKey: ["ws-skill-detail", selected] });
    } catch {
      toast(t("skills.save_failed"), "err");
    } finally {
      setSaving(false);
    }
  };

  const roles = skills.filter((s) => s.type === "role");
  const tools = skills.filter((s) => s.type !== "role");

  return (
    <>
      <SplitPane
        left={
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", display: "flex", gap: 4, flexShrink: 0 }}>
              {selected && (
                <button className="btn btn--xs" onClick={() => { setSelected(null); setEditContent(null); }}>{t("common.back")}</button>
              )}
              <button className="btn btn--xs" onClick={() => setShowImport(true)}>{t("skills.import")}</button>
              <button className="btn btn--xs" onClick={() => void refresh()}>{t("common.refresh")}</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {roles.length > 0 && (
                <>
                  <div style={{ padding: "6px 14px 2px", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{t("skills.category_roles")}</div>
                  {roles.map((s) => (
                    <div
                      key={s.name}
                      onClick={() => handle_select(s.name)}
                      style={{
                        padding: "8px 14px", cursor: "pointer", fontSize: 12,
                        background: selected === s.name ? "var(--panel-elevated)" : "none",
                        borderLeft: selected === s.name ? "3px solid var(--accent)" : "3px solid transparent",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ color: "var(--muted)", marginTop: 2, display: "flex", gap: 4 }}>
                        <Badge status={s.source} variant="info" />
                      </div>
                    </div>
                  ))}
                </>
              )}
              {tools.length > 0 && (
                <>
                  <div style={{ padding: "6px 14px 2px", fontSize: 11, color: "var(--ok)", fontWeight: 600, borderTop: roles.length > 0 ? "1px solid var(--line)" : undefined }}>{t("skills.category_tools")}</div>
                  {tools.map((s) => (
                    <div
                      key={s.name}
                      onClick={() => handle_select(s.name)}
                      style={{
                        padding: "8px 14px", cursor: "pointer", fontSize: 12,
                        background: selected === s.name ? "var(--panel-elevated)" : "none",
                        borderLeft: selected === s.name ? "3px solid var(--ok)" : "3px solid transparent",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ color: "var(--muted)", marginTop: 2, display: "flex", gap: 4 }}>
                        <Badge status={s.source} variant="info" />
                      </div>
                    </div>
                  ))}
                </>
              )}
              {skills.length === 0 && <p className="empty" style={{ padding: 14, fontSize: 12 }}>-</p>}
            </div>
          </div>
        }
        right={
          !selected || !detail ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{t("workspace.select_item")}</span>
              </div>
              <p className="empty">{t("workspace.select_item")}</p>
            </div>
          ) : (
            <div style={{ display: "flex", height: "100%" }}>
              {/* 메타데이터 패널 */}
              <div style={{ width: 200, borderRight: "1px solid var(--line)", overflow: "auto", flexShrink: 0 }}>
                {detail.metadata && (
                  <table className="data-table" style={{ fontSize: 11 }}>
                    <tbody>
                      <tr><td style={{ color: "var(--muted)" }}>{t("common.type")}</td><td><Badge status={detail.metadata.type} variant="info" /></td></tr>
                      <tr><td style={{ color: "var(--muted)" }}>{t("skills.source")}</td><td><Badge status={detail.metadata.source} variant={detail.metadata.source === "builtin" ? "off" : "ok"} /></td></tr>
                      {detail.metadata.model && <tr><td style={{ color: "var(--muted)" }}>{t("skills.model")}</td><td>{detail.metadata.model}</td></tr>}
                      {detail.metadata.role && <tr><td style={{ color: "var(--muted)" }}>{t("skills.role")}</td><td>{detail.metadata.role}</td></tr>}
                      {detail.metadata.aliases.length > 0 && <tr><td style={{ color: "var(--muted)" }}>{t("skills.aliases")}</td><td style={{ fontSize: 10 }}>{detail.metadata.aliases.join(", ")}</td></tr>}
                      {detail.metadata.tools.length > 0 && <tr><td style={{ color: "var(--muted)" }}>{t("skills.tools")}</td><td style={{ fontSize: 10 }}>{detail.metadata.tools.join(", ")}</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
              {/* 파일 내용 패널 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)", flexShrink: 0, overflowX: "auto" }}>
                  <div style={{ display: "flex", flex: 1 }}>
                    {["SKILL.md", ...(detail.references?.map((r) => r.name) ?? [])].map((name) => (
                      <button
                        key={name}
                        onClick={() => handle_tab_change(name)}
                        style={{
                          padding: "6px 12px", fontSize: 11, border: "none",
                          borderBottom: activeFile === name ? "2px solid var(--accent)" : "2px solid transparent",
                          background: "none", cursor: "pointer",
                          color: activeFile === name ? "var(--accent)" : "var(--muted)",
                          whiteSpace: "nowrap", flexShrink: 0,
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {is_editable && (
                    <div style={{ display: "flex", gap: 4, padding: "0 8px", flexShrink: 0 }}>
                      {editContent !== null && (
                        <>
                          <button className="btn btn--xs btn--ok" onClick={() => void save()} disabled={saving}>
                            {t(saving ? "common.saving" : "common.save")}
                          </button>
                          <button className="btn btn--xs" onClick={() => setEditContent(null)}>{t("common.cancel")}</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {is_editable && activeFile === "SKILL.md" && (
                  <ToolPicker
                    content={active_content}
                    onChange={(newContent) => setEditContent(newContent)}
                    all_tools={all_tools}
                    native_tools={native_tools}
                    oauth_services={oauth_services}
                    roles={roles}
                  />
                )}
                {is_editable ? (
                  <textarea
                    value={active_content}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={{
                      flex: 1, resize: "none", border: "none",
                      background: editContent !== null ? "var(--bg)" : "var(--panel-elevated)",
                      color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11,
                      lineHeight: 1.6, padding: 10, outline: "none",
                    }}
                  />
                ) : (
                  <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
                    {active_content ? (
                      <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{active_content}</pre>
                    ) : (
                      <p className="empty">{t("skills.no_content")}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        }
      />

      <Modal
        open={showImport}
        title={t("skills.import_title")}
        onClose={() => { setShowImport(false); setImportName(""); setZipFile(null); }}
        onConfirm={() => void confirm_import()}
        confirmLabel={importing ? "..." : t("skills.import")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 12 }}>
            <span style={{ display: "block", marginBottom: 4, color: "var(--muted)" }}>{t("skills.import_name")}</span>
            <input
              className="input"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder={t("skills.import_name_hint")}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            <span style={{ display: "block", marginBottom: 4, color: "var(--muted)" }}>{t("skills.import_file")}</span>
            <input ref={fileRef} type="file" accept=".zip" onChange={handle_import_file} style={{ fontSize: 12 }} />
            {zipFile && (
              <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "block" }}>
                {zipFile.name} ({Math.round(zipFile.size / 1024)} KB)
              </span>
            )}
          </label>
        </div>
      </Modal>
    </>
  );
}
