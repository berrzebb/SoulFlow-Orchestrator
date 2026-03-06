import { useState, useRef, createContext, useContext, type ReactNode } from "react";

type ToastVariant = "ok" | "err" | "warn" | "info";
interface Toast { id: number; message: string; variant: ToastVariant; exiting?: boolean }

interface ToastCtx {
  toast: (message: string, variant?: ToastVariant) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next_id = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>[]>());

  const clear_timers = (id: number) => {
    const list = timers.current.get(id);
    if (list) { list.forEach(clearTimeout); timers.current.delete(id); }
  };

  const dismiss = (id: number) => {
    clear_timers(id);
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    const t = setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
    timers.current.set(id, [t]);
  };

  const toast = (message: string, variant: ToastVariant = "info") => {
    const id = ++next_id.current;
    const duration = variant === "err" ? 5000 : 3000;
    setToasts((prev) => [...prev, { id, message, variant }]);
    const t1 = setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t)), duration - 300);
    const t2 = setTimeout(() => { setToasts((prev) => prev.filter((t) => t.id !== id)); timers.current.delete(id); }, duration);
    timers.current.set(id, [t1, t2]);
  };

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}${t.exiting ? " toast--exit" : ""}`}>
            <span className="toast__msg">{t.message}</span>
            <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Close">✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
