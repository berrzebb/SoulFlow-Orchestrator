import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { EmptyState } from "../../components/empty-state";
import { Modal } from "../../components/modal";
import { useToast } from "../../components/toast";
import { useT } from "../../i18n";
import { useAsyncAction } from "../../hooks/use-async-action";
import { useAsyncState } from "../../hooks/use-async-state";
import { SplitPane } from "./split-pane";
import { WsListItem } from "./ws-shared";

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
  const { toast } = useToast();
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
    } catch {
      toast(t("skills.role_load_failed"), "err");
    } finally {
      setLoadingRole(null);
    }
  };

  const chip_cls = (active: boolean, variant?: string) => {
    const base = "filter-chip";
    const v = variant ? ` filter-chip--${variant}` : "";
    return active ? `${base}${v} filter-chip--active` : base;
  };

  if (all_tools.length === 0 && native_tools.length === 0 && oauth_services.length === 0) return null;
  return (
    <div className="ws-chip-bar">
      {all_tools.length > 0 && (
        <div className="ws-chip-row">
          <span className="ws-chip-label text-muted">{t("skills.tools")}:</span>
          {all_tools.map((tool) => <button key={tool} type="button" className={chip_cls(tools_set.has(tool))} onClick={() => toggle_tool(tool)}>{tool}</button>)}
        </div>
      )}
      {native_tools.length > 0 && (
        <div className="ws-chip-row">
          <span className="ws-chip-label text-ok">SDK:</span>
          {native_tools.map((tool) => <button key={tool} type="button" className={chip_cls(tools_set.has(tool), "ok")} onClick={() => toggle_tool(tool)}>{tool}</button>)}
        </div>
      )}
      {oauth_services.length > 0 && (
        <div className="ws-chip-row">
          <span className="ws-chip-label text-warn">OAuth:</span>
          {oauth_services.map((svc) => <button key={svc} type="button" className={chip_cls(oauth_set.has(svc), "warn")} onClick={() => toggle_oauth(svc)}>{svc}</button>)}
        </div>
      )}
      {roles.length > 0 && (
        <div className="ws-chip-row">
          <span className="ws-chip-label text-muted">{t("skills.from_role")}:</span>
          {roles.map((role) => (
            <button
              key={role.name}
              className="btn btn--xs"
              disabled={loading_role !== null}
              onClick={() => void add_from_role(role.name)}
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
  const run_action = useAsyncAction();
  const { pending: importing, run: run_import } = useAsyncState();
  const { pending: saving, run: run_save } = useAsyncState();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState("SKILL.md");
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [editContent, setEditContent] = useState<string | null>(null);
  const [metaExpanded, setMetaExpanded] = useState(false);

  const { data: skills = [] } = useQuery<SkillInfo[]>({
    queryKey: ["ws-skills"],
    queryFn: () => api.get("/api/skills"),
    staleTime: 30_000,
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
    queryFn: () => api.get<SkillDetail>(`/api/skills/${encodeURIComponent(selected!)}`),
    enabled: !!selected,
  });

  const refresh = () => run_action(async () => {
    await api.post("/api/skills/refresh");
    void qc.invalidateQueries({ queryKey: ["ws-skills"] });
  }, t("skills.refreshed"));

  const handle_import_file = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipFile(file);
    if (!importName) setImportName(file.name.replace(/\.zip$/i, ""));
  };

  const confirm_import = () => {
    if (!importName.trim() || !zipFile) return;
    void run_import(async () => {
      const buf = await zipFile.arrayBuffer();
      const zip_b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      await api.post("/api/skills", { name: importName.trim(), zip_b64 });
      void qc.invalidateQueries({ queryKey: ["ws-skills"] });
      setShowImport(false);
      setImportName("");
      setZipFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }, t("skills.imported", { name: importName.trim() }), t("common.unknown_error"));
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
    // 이미 선택된 item 다시 클릭 → 선택 해제 (토글)
    if (selected === name) {
      setSelected(null);
      setEditContent(null);
      return;
    }
    setSelected(name);
    setActiveFile("SKILL.md");
    setEditContent(null);
    setMetaExpanded(false);
  };

  const save = () => {
    if (!selected || editContent === null) return;
    void run_save(async () => {
      await api.put(`/api/skills/${encodeURIComponent(selected)}/files`, { file: activeFile, content: editContent });
      setEditContent(null);
      void qc.invalidateQueries({ queryKey: ["ws-skill-detail", selected] });
    }, t("skills.saved"), t("skills.save_failed"));
  };

  const roles = skills.filter((s) => s.type === "role");
  const tools = skills.filter((s) => s.type !== "role");

  return (
    <>
      <SplitPane
        showRight={!!selected}
        left={
          <div className="ws-col">
            <div className="ws-toolbar">
              {selected && (
                <button className="btn btn--sm" onClick={() => { setSelected(null); setEditContent(null); }} aria-label={t("common.back")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                  {t("common.back")}
                </button>
              )}
              <button className="btn btn--xs" onClick={() => setShowImport(true)}>{t("skills.import")}</button>
              <button className="btn btn--xs" onClick={() => void refresh()}>{t("common.refresh")}</button>
            </div>
            <div className="ws-scroll">
              {roles.length > 0 && (
                <>
                  <div className="ws-group-label text-accent">{t("skills.category_roles")}</div>
                  {roles.map((s) => (
                    <WsListItem key={s.name} id={s.name} active={selected === s.name} onClick={() => handle_select(s.name)}>
                      <div className="ws-item__name">{s.name}</div>
                      <div className="ws-item__meta"><Badge status={s.source} variant="info" /></div>
                    </WsListItem>
                  ))}
                </>
              )}
              {tools.length > 0 && (
                <>
                  <div className={`ws-group-label text-ok${roles.length > 0 ? " ws-group-label--bordered" : ""}`}>{t("skills.category_tools")}</div>
                  {tools.map((s) => (
                    <WsListItem key={s.name} id={s.name} active={selected === s.name} onClick={() => handle_select(s.name)} className={selected === s.name ? "ws-item--active-ok" : undefined}>
                      <div className="ws-item__name">{s.name}</div>
                      <div className="ws-item__meta"><Badge status={s.source} variant="info" /></div>
                    </WsListItem>
                  ))}
                </>
              )}
              {skills.length === 0 && <EmptyState icon="🛠️" title={t("skills.no_skills")} />}
            </div>
          </div>
        }
        right={
          !selected || !detail ? (
            <div className="ws-col">
              <div className="ws-detail-header">
                <span className="fw-600 text-sm">{t("workspace.select_item")}</span>
              </div>
              <EmptyState icon="🛠️" title={t("workspace.select_item")} />
            </div>
          ) : (
            <div className="ws-detail-row">
              <div className={`ws-meta-panel ws-meta-panel--clickable${metaExpanded ? " ws-meta-panel--expanded" : ""}`} role="button" tabIndex={0} aria-expanded={metaExpanded} onClick={() => setMetaExpanded((v) => !v)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMetaExpanded((v) => !v); } }}>
                {detail.metadata && (
                  <table className="data-table data-table--xs">
                    <tbody>
                      <tr><td className="text-muted">{t("common.type")}</td><td><Badge status={detail.metadata.type} variant="info" /></td></tr>
                      <tr><td className="text-muted">{t("skills.source")}</td><td><Badge status={detail.metadata.source} variant={detail.metadata.source === "builtin" ? "off" : "ok"} /></td></tr>
                      {detail.metadata.model && <tr><td className="text-muted">{t("skills.model")}</td><td>{detail.metadata.model}</td></tr>}
                      {detail.metadata.role && <tr><td className="text-muted">{t("skills.role")}</td><td>{detail.metadata.role}</td></tr>}
                      {detail.metadata.aliases.length > 0 && <tr><td className="text-muted">{t("skills.aliases")}</td><td className="text-xs">{detail.metadata.aliases.join(", ")}</td></tr>}
                      {detail.metadata.triggers.length > 0 && <tr><td className="text-muted">{t("skills.triggers")}</td><td className="text-xs">{detail.metadata.triggers.join(", ")}</td></tr>}
                      {detail.metadata.tools.length > 0 && <tr><td className="text-muted">{t("skills.tools")}</td><td className="text-xs">{detail.metadata.tools.join(", ")}</td></tr>}
                      {detail.metadata.requirements.length > 0 && <tr><td className="text-muted">{t("skills.requirements")}</td><td className="text-xs">{detail.metadata.requirements.join(", ")}</td></tr>}
                      {detail.metadata.shared_protocols.length > 0 && <tr><td className="text-muted">{t("skills.protocols")}</td><td className="text-xs">{detail.metadata.shared_protocols.join(", ")}</td></tr>}
                      {detail.metadata.soul && <tr><td className="text-muted">{t("skills.soul")}</td><td className="text-xs">{detail.metadata.soul}</td></tr>}
                      {detail.metadata.heart && <tr><td className="text-muted">{t("skills.heart")}</td><td className="text-xs">{detail.metadata.heart}</td></tr>}
                      {detail.metadata.always && <tr><td className="text-muted">{t("skills.always")}</td><td><Badge status={t("common.yes")} variant="ok" /></td></tr>}
                      {detail.metadata.path && <tr><td className="text-muted">{t("skills.path")}</td><td className="text-xs break-all">{detail.metadata.path}</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="ws-col ws-col--clip">
                <div className="ws-tab-bar">
                  <button className="ws-back-btn" onClick={() => { setSelected(null); setEditContent(null); }}>{t("common.back")}</button>
                  <div className="flex-fill li-flex" role="tablist">
                    {["SKILL.md", ...(detail.references?.map((r) => r.name) ?? [])].map((name) => (
                      <button key={name} role="tab" aria-selected={activeFile === name} onClick={() => handle_tab_change(name)} className={`ws-tab${activeFile === name ? " ws-tab--active" : ""}`}>
                        {name}
                      </button>
                    ))}
                  </div>
                  {is_editable && (
                    <div className="li-flex ws-tab-bar__actions">
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
                    className={`ws-editor ${editContent !== null ? "ws-editor--editing" : "ws-editor--readonly"}`}
                    value={active_content}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                ) : (
                  <div className="ws-preview">
                    {active_content ? (
                      <pre>{active_content}</pre>
                    ) : (
                      <EmptyState icon="📄" title={t("skills.no_content")} />
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
        <div className="ws-import-form">
          <label className="ws-import-label">
            <span className="ws-import-hint">{t("skills.import_name")}</span>
            <input autoFocus className="form-input" value={importName} onChange={(e) => setImportName(e.target.value)} placeholder={t("skills.import_name_hint")} />
          </label>
          <label className="ws-import-label">
            <span className="ws-import-hint">{t("skills.import_file")}</span>
            <input ref={fileRef} type="file" accept=".zip" onChange={handle_import_file} className="text-xs" />
            {zipFile && (
              <span className="text-xs text-muted d-block mt-1">
                {zipFile.name} ({Math.round(zipFile.size / 1024)} KB)
              </span>
            )}
          </label>
        </div>
      </Modal>
    </>
  );
}
