import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { create_sse } from "../api/sse";
import { useDashboardStore } from "../store";
import { useI18n } from "../i18n";
import { api } from "../api/client";
import { useRef, useState } from "react";
import { useAuthStatus, useAuthUser, useLogout, useMyTeams, useSwitchTeam } from "../hooks/use-auth";
import { useClickOutside } from "../hooks/use-click-outside";

export function RootLayout() {
  const set_connection = useDashboardStore((s) => s.set_connection);
  const connection = useDashboardStore((s) => s.connection);
  const open_sidebar = useDashboardStore((s) => s.open_sidebar);
  const set_web_stream = useDashboardStore((s) => s.set_web_stream);
  const set_mirror_event = useDashboardStore((s) => s.set_mirror_event);
  const theme = useDashboardStore((s) => s.theme);
  const toggle_theme = useDashboardStore((s) => s.toggle_theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  const qc = useQueryClient();
  const { t, locale, set_locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const toggle_locale = () => set_locale(locale === "en" ? "ko" : "en");

  const { data: auth_status } = useAuthStatus();
  const { data: auth_user, isLoading: auth_loading, isFetching: auth_fetching } = useAuthUser();
  const logout = useLogout();
  const { data: my_teams = [] } = useMyTeams();
  const switch_team = useSwitchTeam();
  const [team_menu_open, set_team_menu_open] = useState(false);
  const team_menu_ref = useRef<HTMLDivElement>(null);
  useClickOutside(team_menu_ref, () => set_team_menu_open(false), team_menu_open);

  // auth 활성화 시 미인증 → /login 리다이렉트
  // isFetching도 체크: 로그인 직후 refetch 중 null 상태로 오인해 다시 /login으로 보내는 race condition 방지
  useEffect(() => {
    if (!auth_status?.enabled) return;
    if (auth_loading || auth_fetching) return;
    if (location.pathname === "/login") return;
    if (auth_user === null) navigate("/login", { replace: true });
  }, [auth_status, auth_user, auth_loading, auth_fetching, location.pathname, navigate]);

  // 로그인 페이지에서 이미 인증된 상태면 홈으로
  useEffect(() => {
    if (location.pathname !== "/login") return;
    if (!auth_status?.enabled) { navigate("/", { replace: true }); return; }
    if (auth_user) navigate("/", { replace: true });
  }, [auth_status, auth_user, location.pathname, navigate]);

  // 첫 실행 시 프로바이더 미설정이면 셋업 위저드로 리다이렉트
  // auth 상태 로드 전에는 대기 — 로그인이 반드시 먼저 수행되어야 함
  useEffect(() => {
    if (location.pathname === "/setup") return;
    if (location.pathname === "/login") return;
    if (auth_status === undefined) return;
    if (auth_status.enabled && !auth_user) return;
    api.get<{ needed: boolean }>("/api/bootstrap/status")
      .then((res) => { if (res.needed) navigate("/setup"); })
      .catch(() => {});
  }, [location.pathname, navigate, auth_status, auth_user]);

  useEffect(() => {
    let msg_timer: ReturnType<typeof setTimeout> | null = null;
    const debounced_message = () => {
      if (msg_timer) clearTimeout(msg_timer);
      msg_timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["state"] });
        void qc.invalidateQueries({ queryKey: ["chat-session"] });
        void qc.invalidateQueries({ queryKey: ["chat-sessions"] });
      }, 300);
    };
    const sse = create_sse("/api/events", {
      ready: () => set_connection("connected"),
      reload: () => void qc.invalidateQueries(),
      process: () => void qc.invalidateQueries({ queryKey: ["state"] }),
      cron: () => void qc.invalidateQueries({ queryKey: ["state"] }),
      message: debounced_message,
      web_stream: (data: unknown) => {
        const d = data as { chat_id?: string; content?: string; done?: boolean };
        if (d.done) {
          const prev = useDashboardStore.getState().web_stream;
          if (prev) set_web_stream({ ...prev, done: true });
          // web_message 이벤트가 메시지 저장 후 정확한 시점에 invalidate하므로 여기선 생략
          return;
        }
        if (d.chat_id) set_web_stream({ chat_id: d.chat_id, content: d.content ?? "" });
      },
      web_message: (data: unknown) => {
        const d = data as { chat_id?: string };
        if (d.chat_id) void qc.invalidateQueries({ queryKey: ["chat-session", d.chat_id] });
      },
      mirror_message: (data: unknown) => {
        const d = data as { session_key?: string; direction?: string; sender_id?: string; content?: string; at?: string };
        if (d.session_key) set_mirror_event({ session_key: d.session_key, direction: d.direction ?? "", sender_id: d.sender_id ?? "", content: d.content ?? "", at: d.at ?? "" });
      },
      task: () => void qc.invalidateQueries({ queryKey: ["state"] }),
      agent: () => void qc.invalidateQueries({ queryKey: ["state"] }),
      progress: () => void qc.invalidateQueries({ queryKey: ["state"] }),
    });
    set_connection("reconnecting");
    return () => { if (msg_timer) clearTimeout(msg_timer); sse.close(); set_connection("disconnected"); };
  }, [set_connection, set_web_stream, set_mirror_event, qc]);

  return (
    <div className="app">
      <a className="skip-to-content" href="#main-content">{t("a11y.skip_to_content")}</a>
      <Sidebar />
      <div className="app__main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="topbar__hamburger" onClick={open_sidebar} aria-label={t("sidebar.expand")}>
              ☰
            </button>
            <h1 className="topbar__title">{t("app.title")}</h1>
          </div>
          <div className="topbar__meta">
            <button
              className="btn btn--xs topbar__theme-btn"
              onClick={toggle_theme}
              aria-label={t("sidebar.toggle_theme")}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button
              className="btn btn--xs topbar__locale-btn"
              onClick={toggle_locale}
              aria-label={t("sidebar.toggle_language")}
            >
              {locale === "en" ? "한국어" : "English"}
            </button>
            {auth_status?.enabled && auth_user && (
              <>
                {auth_user.tid && (
                  <div ref={team_menu_ref} className="topbar__team-switcher">
                    <button
                      className="topbar__team-badge"
                      onClick={() => set_team_menu_open((o) => !o)}
                      aria-haspopup="listbox"
                      aria-expanded={team_menu_open}
                      title="팀 전환"
                    >
                      {my_teams.find((t) => t.id === auth_user.tid)?.name ?? auth_user.tid}
                      {" ▾"}
                    </button>
                    {team_menu_open && (
                      <div className="topbar__team-menu" role="listbox" aria-label="팀 전환">
                        {my_teams.map((t) => (
                          <button
                            key={t.id}
                            className={`topbar__team-menu-item${t.id === auth_user.tid ? " topbar__team-menu-item--active" : ""}`}
                            role="option"
                            aria-selected={t.id === auth_user.tid}
                            disabled={switch_team.isPending}
                            onClick={() => {
                              if (t.id !== auth_user.tid) switch_team.mutate(t.id, { onSuccess: () => set_team_menu_open(false) });
                              else set_team_menu_open(false);
                            }}
                          >
                            <span>{t.name || t.id}</span>
                            <span className="topbar__team-role">{t.role}</span>
                          </button>
                        ))}
                        {my_teams.length === 0 && (
                          <span className="topbar__team-menu-empty">소속 팀 없음</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <span className="topbar__username" title={auth_user.role}>
                  {auth_user.username}
                </span>
                <button
                  className="btn btn--xs topbar__logout-btn"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  aria-label="로그아웃"
                >
                  로그아웃
                </button>
              </>
            )}
            <span className={`topbar__conn topbar__conn--${connection}`}>
              {t(`conn.${connection}`)}
            </span>
          </div>
        </header>
        <main className="app__content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
