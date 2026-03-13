import { Link } from "react-router-dom";
import { useStatus } from "../../api/hooks";
import { Badge } from "../../components/badge";
import { classify_agent } from "../../utils/classify";
import { useT } from "../../i18n";
import type { DashboardState } from "./types";
import { ACTIVE_TASK_STATUSES } from "./types";
import { SkeletonGrid } from "../../components/skeleton-grid";

export default function OverviewPage() {
  const t = useT();
  const { data, isLoading } = useStatus();
  const s = data as DashboardState | undefined;

  if (isLoading || !s) {
    return <SkeletonGrid count={2} className="stat-grid" />;
  }

  const working_agents = s.agents?.filter((a) => classify_agent(a.status) === "working").length ?? 0;
  const active_tasks = s.tasks?.filter((tk) => ACTIVE_TASK_STATUSES.has(tk.status)).length ?? 0;

  return (
    <div className="overview fade-in">
      {/* Stat cards: Tasks + Agents */}
      <div className="stat-grid">
        <Link to="/workspace">
          <div className="stat-card">
            <div className="stat-card__header">
              <div className="stat-card__icon stat-card__icon--accent">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                </svg>
              </div>
              {active_tasks > 0 && <Badge status={t("overview.active_fmt", { count: active_tasks })} variant="ok" />}
            </div>
            <div className="stat-card__value">{s.tasks?.length ?? 0}</div>
            <div className="stat-card__label">{t("overview.tasks")}</div>
          </div>
        </Link>

        {(s.agents?.length ?? 0) > 0 && (
          <Link to="/workspace">
            <div className="stat-card">
              <div className="stat-card__header">
                <div className="stat-card__icon stat-card__icon--warn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
                  </svg>
                </div>
                {working_agents > 0 && <Badge status={t("overview.working_fmt", { count: working_agents })} variant="warn" />}
              </div>
              <div className="stat-card__value">{s.agents?.length ?? 0}</div>
              <div className="stat-card__label">{t("overview.agents")}</div>
            </div>
          </Link>
        )}
      </div>

      {/* Messages */}
      <section className="panel panel--flush">
        <h2>{t("overview.messages")}</h2>
        <ul className="list list--compact">
          {!s.messages?.length && <li className="empty">-</li>}
          {s.messages?.map((m, i) => (
            <li key={`${m.direction}-${m.sender_id}-${i}`}>
              <span className="li-text li-flex li-flex--baseline">
                <span className={`fw-600 truncate msg-sender ${m.direction === "inbound" ? "msg-sender--in" : "msg-sender--out"}`}>
                  {m.direction === "inbound" ? t("overview.msg_in") : t("overview.msg_out")} {m.sender_id}
                </span>
                <span className="truncate text-sm text-muted flex-fill">{m.content}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="overview__timestamp text-xs text-muted">{s.now || "-"}</div>
    </div>
  );
}
