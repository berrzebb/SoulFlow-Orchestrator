import { useState, useRef, useCallback, createContext, useContext, type ReactNode } from "react";

type ToastVariant = "ok" | "err" | "warn" | "info";
interface Toast { id: number; message: string; variant: ToastVariant }

interface ToastCtx {
  toast: (message: string, variant?: ToastVariant) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next_id = useRef(0);

  const toast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++next_id.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.variant}`}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
