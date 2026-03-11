import { NavLink } from "react-router-dom";
import { useDashboardStore } from "../store";
import { useI18n } from "../i18n";

type NavItem = { to: string; key: string; icon: string };
type NavGroup = { label_key: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label_key: "nav.group.main",
    items: [
      { to: "/", key: "nav.overview", icon: "\u25c8" },
      { to: "/chat", key: "nav.chat", icon: "\ud83d\udcac" },
    ],
  },
  {
    label_key: "nav.group.build",
    items: [
      { to: "/agents", key: "nav.agents", icon: "\ud83e\udde0" },
      { to: "/workflows", key: "nav.workflows", icon: "\u25b7" },
      { to: "/kanban", key: "nav.kanban", icon: "\u25a3" },
      { to: "/wbs", key: "nav.wbs", icon: "\u2630" },
      { to: "/workspace", key: "nav.workspace", icon: "\u25a6" },
    ],
  },
  {
    label_key: "nav.group.connect",
    items: [
      { to: "/channels", key: "nav.channels", icon: "\u21cc" },
      { to: "/providers", key: "nav.providers", icon: "\u2b21" },
    ],
  },
  {
    label_key: "nav.group.system",
    items: [
      { to: "/secrets", key: "nav.secrets", icon: "\u26bf" },
      { to: "/settings", key: "nav.settings", icon: "\u229e" },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const BOTTOM_NAV_KEYS = new Set(["/", "/chat", "/workflows", "/workspace", "/settings"]);

export function Sidebar() {
  const collapsed = useDashboardStore((s) => s.sidebar_collapsed);
  const toggle = useDashboardStore((s) => s.toggle_sidebar);
  const open = useDashboardStore((s) => s.sidebar_open);
  const close = useDashboardStore((s) => s.close_sidebar);
  const { t } = useI18n();

  const cls = [
    "sidebar",
    collapsed ? "sidebar--collapsed" : "",
    open ? "sidebar--open" : "",
  ].filter(Boolean).join(" ");

  const handle_nav = () => {
    if (window.innerWidth <= 768) close();
  };

  return (
    <>
      <div
        className={`sidebar-backdrop ${open ? "sidebar-backdrop--visible" : ""}`}
        role="presentation"
        onClick={close}
      />
      <nav className={cls}>
        <div className="sidebar__header">
          {!collapsed && <span className="sidebar__title">{t("app.brand")}</span>}
          <button className="sidebar__toggle" onClick={toggle} aria-label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}>
            {collapsed ? "\u25b8" : "\u25c2"}
          </button>
        </div>
        <ul className="sidebar__nav">
          {NAV_GROUPS.map((group) => (
            <li key={group.label_key} className="sidebar__group">
              {!collapsed && <span className="sidebar__group-label">{t(group.label_key)}</span>}
              <ul className="sidebar__group-items">
                {group.items.map((item) => {
                  const label = t(item.key);
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        className={({ isActive }) => `sidebar__link ${isActive ? "sidebar__link--active" : ""}`}
                        onClick={handle_nav}
                      >
                        <span className="sidebar__icon" data-tooltip={label}>{item.icon}</span>
                        {!collapsed && <span className="sidebar__label">{label}</span>}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      <BottomNav />
    </>
  );
}

function BottomNav() {
  const { t } = useI18n();
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {ALL_NAV_ITEMS.filter((item) => BOTTOM_NAV_KEYS.has(item.to)).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => `bottom-nav__item ${isActive ? "bottom-nav__item--active" : ""}`}
        >
          <span className="bottom-nav__icon">{item.icon}</span>
          <span className="bottom-nav__label">{t(item.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
