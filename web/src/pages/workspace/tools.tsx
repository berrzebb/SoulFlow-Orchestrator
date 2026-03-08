import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Badge } from "../../components/badge";
import { SearchInput } from "../../components/search-input";
import { SectionHeader } from "../../components/section-header";
import { WsSkeletonCol } from "./ws-shared";
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
  return (
    <span className={`tool-card__icon tool-card__icon--${is_mcp ? "mcp" : "native"}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function ToolCard({ name, description, parameters, is_mcp, is_open, onToggle }: {
  name: string; description: string; parameters: Record<string, unknown>; is_mcp: boolean; is_open: boolean; onToggle: (name: string) => void;
}) {
  const t = useT();
  const loc_desc = (!is_mcp && t(`tool.${name}.desc`) !== `tool.${name}.desc`) ? t(`tool.${name}.desc`) : description;
  const loc_param = (p_name: string, fallback: string) => {
    const key = `tool.${name}.param.${p_name}`;
    const val = t(key);
    return val !== key ? val : fallback;
  };
  const params = extract_params(parameters);

  return (
    <div className="tool-card">
      <div className="tool-card__header">
        <ToolIcon name={name} is_mcp={is_mcp} />
        <div className="tool-card__body">
          <div className="tool-card__name">{name}</div>
          {is_mcp && <div className="mt-1"><Badge status="mcp" variant="ok" /></div>}
        </div>
      </div>
      {loc_desc && <div className="tool-card__desc">{loc_desc}</div>}
      {params.length > 0 && (
        <div className="tool-card__tags">
          {params.slice(0, 4).map((p) => (
            <span key={p.name} className={`param-chip${p.required ? " param-chip--required" : ""}`}>
              {p.name}
            </span>
          ))}
          {params.length > 4 && <span className="text-xs text-muted">+{params.length - 4}</span>}
        </div>
      )}
      {params.length > 0 && (
        <>
          <button className="btn btn--xs tool-card__toggle" aria-expanded={is_open} onClick={() => onToggle(name)}>
            {is_open ? "▾" : "▸"} {t("tools.params")} ({params.length})
          </button>
          {is_open && (
            <div className="tool-card__params">
              {params.map((p) => {
                const p_desc = loc_param(p.name, p.description);
                return (
                  <div key={p.name} className="tool-card__param">
                    <div className="tool-card__param-header">
                      <code className="fw-600 text-accent">{p.name}</code>
                      <Badge status={p.type} variant="info" />
                      {p.required && <Badge status={t("tools.required")} variant="warn" />}
                    </div>
                    {p_desc && <span className="text-muted tool-card__param-desc">{p_desc}</span>}
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
            parameters={fn.parameters}
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
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery<ToolsResponse>({ queryKey: ["tools"], queryFn: () => api.get("/api/tools"), staleTime: 30_000 });

  if (isLoading || !data) return <WsSkeletonCol rows={["card", "card"]} />;

  const mcp_tool_names = new Set((data.mcp_servers ?? []).flatMap((s) => s.tools));
  const q = search.toLowerCase();
  const match = (d: ToolSchema) => !q || d.function.name.toLowerCase().includes(q) || d.function.description.toLowerCase().includes(q);
  const builtin = (data.definitions ?? []).filter((d) => !mcp_tool_names.has(d.function.name) && match(d));
  const mcp_tools = (data.definitions ?? []).filter((d) => mcp_tool_names.has(d.function.name) && match(d));
  const servers = data.mcp_servers ?? [];
  const total_shown = builtin.length + mcp_tools.length;

  return (
    <div className="fade-in">
      <SectionHeader title={t("tools.title", { count: data.names.length })}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("tools.search")}
          onClear={() => setSearch("")}
          autoFocus
          className="tool-search"
        />
      </SectionHeader>
      {search && <div className="text-xs text-muted mb-2">{t("tools.search_result", { count: total_shown })}</div>}

      {servers.length > 0 && (
        <section className="panel">
          <h3>{t("tools.mcp_servers", { count: servers.length })}</h3>
          <div className="ws-chip-row">
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
    </div>
  );
}
