import { NavLink } from "react-router-dom";
import { useDashboardStore } from "../store";
import { useI18n } from "../i18n";

const NAV_ITEMS = [
  { to: "/", key: "nav.overview", icon: "\u25c8" },
  { to: "/workspace", key: "nav.workspace", icon: "\u25a6" },
  { to: "/chat", key: "nav.chat", icon: "\ud83d\udcac" },
  { to: "/channels", key: "nav.channels", icon: "\u21cc" },
  { to: "/providers", key: "nav.providers", icon: "\u2b21" },
  { to: "/models", key: "nav.models", icon: "\u2b22" },
  { to: "/workflows", key: "nav.workflows", icon: "\u25b7" },
  { to: "/secrets", key: "nav.secrets", icon: "\u26bf" },
  { to: "/settings", key: "nav.settings", icon: "\u229e" },
] as const;

export function Sidebar() {
  const collapsed = useDashboardStore((s) => s.sidebar_collapsed);
  const toggle = useDashboardStore((s) => s.toggle_sidebar);
  const open = useDashboardStore((s) => s.sidebar_open);
  const close = useDashboardStore((s) => s.close_sidebar);
  const theme = useDashboardStore((s) => s.theme);
  const toggle_theme = useDashboardStore((s) => s.toggle_theme);
  const { t, locale, set_locale } = useI18n();

  const cls = [
    "sidebar",
    collapsed ? "sidebar--collapsed" : "",
    open ? "sidebar--open" : "",
  ].filter(Boolean).join(" ");

  const handle_nav = () => {
    if (window.innerWidth <= 768) close();
  };

  const toggle_locale = () => set_locale(locale === "en" ? "ko" : "en");

  return (
    <>
      <div
        className={`sidebar-backdrop ${open ? "sidebar-backdrop--visible" : ""}`}
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
          {NAV_ITEMS.map((item) => {
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
        <div style={{ padding: "var(--sp-2) var(--sp-3)", borderTop: "1px solid var(--line)", display: "flex", flexDirection: collapsed ? "column" : "row", gap: 6 }}>
          <button
            className="btn btn--xs"
            onClick={toggle_theme}
            style={{ flex: collapsed ? undefined : "0 0 auto", fontSize: 14, lineHeight: 1, padding: "4px 8px" }}
            aria-label={t("sidebar.toggle_theme")}
            title={t("sidebar.toggle_theme")}
          >
            {theme === "dark" ? "\u2600\ufe0f" : "\ud83c\udf19"}
          </button>
          <button
            className="btn btn--xs"
            onClick={toggle_locale}
            style={{ flex: 1, fontSize: "var(--fs-xs)", letterSpacing: "0.04em" }}
            aria-label={t("sidebar.toggle_language")}
          >
            {collapsed ? (locale === "en" ? "KO" : "EN") : (locale === "en" ? "한국어" : "English")}
          </button>
        </div>
      </nav>
    </>
  );
}
