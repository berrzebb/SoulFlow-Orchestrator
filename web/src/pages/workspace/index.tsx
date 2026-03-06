import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useT } from "../../i18n";
import { lazyRetryNamed } from "../../utils/lazy-retry";

const MemoryTab = lazyRetryNamed(() => import("./memory"), "MemoryTab");
const SessionsTab = lazyRetryNamed(() => import("./sessions"), "SessionsTab");
const SkillsTab = lazyRetryNamed(() => import("./skills"), "SkillsTab");
const CronTab = lazyRetryNamed(() => import("./cron"), "CronTab");
const ToolsTab = lazyRetryNamed(() => import("./tools"), "ToolsTab");
const AgentsTab = lazyRetryNamed(() => import("./agents"), "AgentsTab");
const TemplatesTab = lazyRetryNamed(() => import("./templates"), "TemplatesTab");
const ModelsTab = lazyRetryNamed(() => import("./models"), "ModelsTab");
const OAuthTab = lazyRetryNamed(() => import("./oauth"), "OAuthTab");

type TabKey = "memory" | "sessions" | "skills" | "cron" | "tools" | "agents" | "templates" | "models" | "oauth";

const TAB_KEYS = new Set<string>(["memory", "sessions", "skills", "cron", "tools", "agents", "templates", "models", "oauth"]);

function useTabParam(): [TabKey, (t: TabKey) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "";
  const tab: TabKey = TAB_KEYS.has(raw) ? (raw as TabKey) : "memory";

  const setTab = (next: TabKey) => {
    setParams({ tab: next }, { replace: true });
  };

  return [tab, setTab];
}

function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  const tabs: { key: TabKey; label: string }[] = [
    { key: "memory", label: t("workspace.tab.memory") },
    { key: "sessions", label: t("workspace.tab.sessions") },
    { key: "skills", label: t("workspace.tab.skills") },
    { key: "cron", label: t("workspace.tab.cron") },
    { key: "tools", label: t("workspace.tab.tools") },
    { key: "agents", label: t("workspace.tab.agents") },
    { key: "templates", label: t("workspace.tab.templates") },
    { key: "models", label: t("workspace.tab.models") },
    { key: "oauth", label: t("workspace.tab.oauth") },
  ];

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const activeEl = bar.querySelector(".ws-tab--active") as HTMLElement | null;
    activeEl?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);

  return (
    <div className="ws-tab-bar" ref={barRef} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          className={`ws-tab ${active === tab.key ? "ws-tab--active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function WorkspacePage() {
  const t = useT();
  const [tab, setTab] = useTabParam();

  return (
    <div className="page">
      <h2 className="mt-0 mb-3">{t("workspace.title")}</h2>
      <TabBar active={tab} onChange={setTab} />
      <Suspense fallback={<div className="skeleton skeleton-card" />}>
        {tab === "memory" && <MemoryTab />}
        {tab === "sessions" && <SessionsTab />}
        {tab === "skills" && <SkillsTab />}
        {tab === "cron" && <CronTab />}
        {tab === "tools" && <ToolsTab />}
        {tab === "agents" && <AgentsTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "oauth" && <OAuthTab />}
      </Suspense>
    </div>
  );
}
