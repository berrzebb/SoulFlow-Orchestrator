import { create } from "zustand";

type ConnectionState = "connected" | "disconnected" | "reconnecting";
type Theme = "dark" | "light";

interface WebStream {
  chat_id: string;
  content: string;
}

interface DashboardStore {
  connection: ConnectionState;
  set_connection: (s: ConnectionState) => void;
  sidebar_collapsed: boolean;
  toggle_sidebar: () => void;
  sidebar_open: boolean;
  open_sidebar: () => void;
  close_sidebar: () => void;
  web_stream: WebStream | null;
  set_web_stream: (s: WebStream | null) => void;
  theme: Theme;
  toggle_theme: () => void;
}

function load_theme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage blocked */ }
  return "dark";
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  connection: "disconnected",
  set_connection: (connection) => set({ connection }),
  sidebar_collapsed: false,
  toggle_sidebar: () => set((s) => ({ sidebar_collapsed: !s.sidebar_collapsed })),
  sidebar_open: false,
  open_sidebar: () => set({ sidebar_open: true }),
  close_sidebar: () => set({ sidebar_open: false }),
  web_stream: null,
  set_web_stream: (web_stream) => set({ web_stream }),
  theme: load_theme(),
  toggle_theme: () => set((s) => {
    const next: Theme = s.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch { /* storage blocked */ }
    return { theme: next };
  }),
}));
