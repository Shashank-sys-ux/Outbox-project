import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string | undefined;
  action?: { label: string; href: string } | undefined;
}

interface ToastApi {
  show(toast: Omit<Toast, "id">): void;
  success(title: string, description?: string, action?: Toast["action"]): void;
  error(title: string, description?: string): void;
  info(title: string, description?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-brand-600" />,
  error: <XCircle aria-hidden="true" className="h-5 w-5 text-red-600" />,
  info: <Info aria-hidden="true" className="h-5 w-5 text-blue-600" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const show = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.variant === "error" ? 7000 : 5000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description, action) => show({ variant: "success", title, description, action }),
      error: (title, description) => show({ variant: "error", title, description }),
      info: (title, description) => show({ variant: "info", title, description }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.variant === "error" ? "alert" : "status"}
            className="animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-white p-4 shadow-lg"
          >
            {ICONS[toast.variant]}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-sm break-words text-muted">{toast.description}</p> : null}
              {toast.action ? (
                <a
                  href={toast.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm font-medium text-brand-700 underline"
                >
                  {toast.action.label}
                </a>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-muted hover:text-ink"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}
