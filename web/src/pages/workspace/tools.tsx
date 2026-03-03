import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { useT } from "../../i18n";

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
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 40, height: 40, borderRadius: 10,
      background: `${color}22`, color, fontWeight: 700, fontSize: 16, flexShrink: 0,
    }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function ToolCard({ name, description, params, is_mcp, is_open, onToggle }: {
  name: string; description: string; params: ParamInfo[]; is_mcp: boolean; is_open: boolean; onToggle: (name: string) => void;
}) {
  const t = useT();
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10,
      padding: "14px 16px", background: "var(--panel)",
      borderRadius: 10, border: "1px solid var(--line)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ToolIcon name={name} is_mcp={is_mcp} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          {is_mcp && <div style={{ marginTop: 2 }}><Badge status="mcp" variant="ok" /></div>}
        </div>
      </div>
      {description && (
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {description}
        </div>
      )}
      {params.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {params.slice(0, 4).map((p) => (
            <span key={p.name} style={{
              padding: "1px 6px", borderRadius: "var(--radius-pill)", fontSize: 10,
              background: p.required ? "rgba(217,164,65,0.12)" : "rgba(74,158,255,0.08)",
              color: p.required ? "var(--warn)" : "var(--muted)",
            }}>
              {p.name}
            </span>
          ))}
          {params.length > 4 && <span style={{ fontSize: 10, color: "var(--muted)", alignSelf: "center" }}>+{params.length - 4}</span>}
        </div>
      )}
      {params.length > 0 && (
        <>
          <button className="btn btn--xs" style={{ alignSelf: "flex-start" }} onClick={() => onToggle(name)}>
            {is_open ? "▾" : "▸"} {t("tools.params")} ({params.length})
          </button>
          {is_open && (
            <div style={{ display: "grid", gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              {params.map((p) => (
                <div key={p.name} style={{
                  display: "flex", flexDirection: "column", gap: 2,
                  padding: "4px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.02)", fontSize: 11,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    <code style={{ color: "var(--accent)", fontWeight: 600 }}>{p.name}</code>
                    <Badge status={p.type} variant="info" />
                    {p.required && <Badge status={t("tools.required")} variant="warn" />}
                  </div>
                  {p.description && (
                    <span style={{ color: "var(--muted)", lineHeight: 1.4, wordBreak: "break-word" }}>{p.description}</span>
                  )}
                </div>
              ))}
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
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
      <h2 style={{ marginBottom: 16 }}>{t("tools.title", { count: data.names.length })}</h2>

      {servers.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>{t("tools.mcp_servers", { count: servers.length })}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {servers.map((s) => (
              <div key={s.name} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", borderRadius: 8,
                background: "var(--panel-elevated)", border: "1px solid var(--line)", fontSize: 12,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: s.connected ? "var(--ok)" : "var(--err)", display: "inline-block" }} />
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: "var(--muted)" }}>{t("tools.server_tool_count", { count: s.tools.length })}</span>
                {s.error && <span style={{ color: "var(--err)", fontSize: 11 }}>⚠ {s.error}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {mcp_tools.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px" }}>{t("tools.mcp_tools", { count: mcp_tools.length })}</h3>
          <ToolGrid tools={mcp_tools} is_mcp />
        </>
      )}

      <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "16px 0 10px" }}>{t("tools.builtin", { count: builtin.length })}</h3>
      <ToolGrid tools={builtin} is_mcp={false} />
    </>
  );
}
