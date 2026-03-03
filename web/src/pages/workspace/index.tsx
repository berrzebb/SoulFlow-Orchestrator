import { useState } from "react";
import { useT } from "../../i18n";
import { MemoryTab } from "./memory";
import { SessionsTab } from "./sessions";
import { SkillsTab } from "./skills";
import { CronTab } from "./cron";
import { ToolsTab } from "./tools";
import { AgentsTab } from "./agents";
import { TemplatesTab } from "./templates";
import { OAuthTab } from "./oauth";

type TabKey = "memory" | "sessions" | "skills" | "cron" | "tools" | "agents" | "templates" | "oauth";

function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const t = useT();
  const tabs: { key: TabKey; label: string }[] = [
    { key: "memory", label: t("workspace.tab.memory") },
    { key: "sessions", label: t("workspace.tab.sessions") },
    { key: "skills", label: t("workspace.tab.skills") },
    { key: "cron", label: t("workspace.tab.cron") },
    { key: "tools", label: t("workspace.tab.tools") },
    { key: "agents", label: t("workspace.tab.agents") },
    { key: "templates", label: t("workspace.tab.templates") },
    { key: "oauth", label: t("workspace.tab.oauth") },
  ];
  return (
    <div style={{ display: "flex", borderBottom: "1px solid var(--line)", marginBottom: 16, gap: 0, overflowX: "auto" }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            padding: "8px 16px", fontSize: 13, fontWeight: active === tab.key ? 600 : 400,
            border: "none", background: "none", cursor: "pointer",
            borderBottom: active === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
            color: active === tab.key ? "var(--accent)" : "var(--muted)",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function WorkspacePage() {
  const t = useT();
  const [tab, setTab] = useState<TabKey>("memory");

  return (
    <div className="page">
      <h2 style={{ marginBottom: 12 }}>{t("workspace.title")}</h2>
      <TabBar active={tab} onChange={setTab} />
      {tab === "memory" && <MemoryTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "skills" && <SkillsTab />}
      {tab === "cron" && <CronTab />}
      {tab === "tools" && <ToolsTab />}
      {tab === "agents" && <AgentsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "oauth" && <OAuthTab />}
    </div>
  );
}
