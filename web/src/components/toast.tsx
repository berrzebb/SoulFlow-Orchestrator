import { useState, useRef, createContext, useContext, type ReactNode } from "react";
import { useT } from "../i18n";

type ToastVariant = "ok" | "err" | "warn" | "info";
interface Toast { id: number; message: string; variant: ToastVariant; exiting?: boolean }

interface ToastCtx {
  toast: (message: string, variant?: ToastVariant) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const tr = useT();
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
    const tid = setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
    timers.current.set(id, [tid]);
  };

  const toast = (message: string, variant: ToastVariant = "info") => {
    const id = ++next_id.current;
    // 스크린 리더가 읽을 시간 확보: 에러 8초, 일반 5초
    const duration = variant === "err" ? 8000 : 5000;
    setToasts((prev) => [...prev, { id, message, variant }]);
    const t1 = setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t)), duration - 300);
    const t2 = setTimeout(() => { setToasts((prev) => prev.filter((t) => t.id !== id)); timers.current.delete(id); }, duration);
    timers.current.set(id, [t1, t2]);
  };

  const close_label = tr("common.close_modal");

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="true" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}${t.exiting ? " toast--exit" : ""}`} role="alert">
            <span className="toast__msg">{t.message}</span>
            <button className="toast__close" onClick={() => dismiss(t.id)} aria-label={close_label}>✕</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
