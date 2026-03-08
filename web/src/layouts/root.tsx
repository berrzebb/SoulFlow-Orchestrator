import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { create_sse } from "../api/sse";
import { useDashboardStore } from "../store";
import { useI18n } from "../i18n";
import { api } from "../api/client";

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

  // 첫 실행 시 프로바이더 미설정이면 셋업 위저드로 리다이렉트
  useEffect(() => {
    if (location.pathname === "/setup") return;
    api.get<{ needed: boolean }>("/api/bootstrap/status")
      .then((res) => { if (res.needed) navigate("/setup"); })
      .catch(() => {});
  }, [location.pathname, navigate]);

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
