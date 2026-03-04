import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useI18n, useT } from "../../i18n";
import { tool_i18n } from "../../i18n/tool-descriptions";

interface ToolSchema {
  type: string;
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface McpServer { name: string; connected: boolean; tools: string[]; error?: string }

interface ToolsResponse { names: string[]; definitions: ToolSchema[]; mcp_servers: McpServer[] }

interface ParamInfo { name: string; type: string; required: boolean; description: string }

function extract_params(parameters: Record<string, unknown>): ParamInfo[] {
  const props = (parameters?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required_set = new Set(Array.isArray(parameters?.required) ? (parameters.required as string[]) : []);
  return Object.entries(props).map(([name, schema]) => ({
    name,
    type: String(schema.type ?? schema.$ref ?? "unknown"),
    required: required_set.has(name),
    description: String(schema.description || ""),
  }));
}

function ToolIcon({ name, is_mcp }: { name: string; is_mcp: boolean }) {
  const color = is_mcp ? "var(--ok)" : "var(--accent)";
  return (
    <span className="tool-card__icon" style={{ background: `${color}22`, color }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function ToolCard({ name, description, params, is_mcp, is_open, onToggle }: {
  name: string; description: string; params: ParamInfo[]; is_mcp: boolean; is_open: boolean; onToggle: (name: string) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const i18n = is_mcp ? undefined : tool_i18n[locale]?.[name];
  const loc_desc = i18n?.desc ?? description;
  const loc_param = (p_name: string, fallback: string) => i18n?.params?.[p_name] ?? fallback;

  return (
    <div className="tool-card">
      <div className="tool-card__header">
        <ToolIcon name={name} is_mcp={is_mcp} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tool-card__name">{name}</div>
          {is_mcp && <div style={{ marginTop: 2 }}><Badge status="mcp" variant="ok" /></div>}
        </div>
      </div>
      {loc_desc && <div className="tool-card__desc">{loc_desc}</div>}
      {params.length > 0 && (
        <div className="tool-card__tags">
          {params.slice(0, 4).map((p) => (
            <span key={p.name} style={{
              padding: "1px 6px", borderRadius: "var(--radius-pill)", fontSize: 10,
              background: p.required ? "rgba(217,164,65,0.12)" : "rgba(74,158,255,0.08)",
              color: p.required ? "var(--warn)" : "var(--muted)",
            }}>
              {p.name}
            </span>
          ))}
          {params.length > 4 && <span className="text-xs text-muted" style={{ alignSelf: "center" }}>+{params.length - 4}</span>}
        </div>
      )}
      {params.length > 0 && (
        <>
          <button className="btn btn--xs" style={{ alignSelf: "flex-start" }} onClick={() => onToggle(name)}>
            {is_open ? "▾" : "▸"} {t("tools.params")} ({params.length})
          </button>
          {is_open && (
            <div className="tool-card__params">
              {params.map((p) => {
                const p_desc = loc_param(p.name, p.description);
                return (
                  <div key={p.name} className="tool-card__param">
                    <div className="tool-card__param-header">
                      <code style={{ color: "var(--accent)" }} className="fw-600">{p.name}</code>
                      <Badge status={p.type} variant="info" />
                      {p.required && <Badge status={t("tools.required")} variant="warn" />}
                    </div>
                    {p_desc && <span className="text-muted" style={{ lineHeight: 1.4, wordBreak: "break-word" }}>{p_desc}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ToolGrid({ tools, is_mcp }: { tools: ToolSchema[]; is_mcp: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  return (
    <div className="tool-grid">
      {tools.map((d) => {
        const fn = d.function;
        return (
          <ToolCard
            key={fn.name}
            name={fn.name}
            description={fn.description}
            params={extract_params(fn.parameters)}
            is_mcp={is_mcp}
            is_open={expanded.has(fn.name)}
            onToggle={toggle}
          />
        );
      })}
    </div>
  );
}

export function ToolsTab() {
  const t = useT();
  const { data, isLoading } = useQuery<ToolsResponse>({ queryKey: ["tools"], queryFn: () => api.get("/api/tools") });

  if (isLoading || !data) return <p className="empty">{t("tools.loading")}</p>;

  const mcp_tool_names = new Set((data.mcp_servers ?? []).flatMap((s) => s.tools));
  const builtin = (data.definitions ?? []).filter((d) => !mcp_tool_names.has(d.function.name));
  const mcp_tools = (data.definitions ?? []).filter((d) => mcp_tool_names.has(d.function.name));
  const servers = data.mcp_servers ?? [];

  return (
    <>
      <h2>{t("tools.title", { count: data.names.length })}</h2>

      {servers.length > 0 && (
        <section className="panel">
          <h3>{t("tools.mcp_servers", { count: servers.length })}</h3>
          <div className="ws-chip-row" style={{ gap: 8 }}>
            {servers.map((s) => (
              <div key={s.name} className="mcp-server">
                <span className={`status-dot status-dot--${s.connected ? "ok" : "err"}`} />
                <span className="fw-600">{s.name}</span>
                <span className="text-muted">{t("tools.server_tool_count", { count: s.tools.length })}</span>
                {s.error && <span className="text-xs text-err">⚠ {s.error}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {mcp_tools.length > 0 && (
        <>
          <h3 className="text-muted">{t("tools.mcp_tools", { count: mcp_tools.length })}</h3>
          <ToolGrid tools={mcp_tools} is_mcp />
        </>
      )}

      <h3 className="text-muted">{t("tools.builtin", { count: builtin.length })}</h3>
      <ToolGrid tools={builtin} is_mcp={false} />
    </>
  );
}
