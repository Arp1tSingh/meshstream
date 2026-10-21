"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "default" | "success" | "error" | "warn";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (title: string, options?: { description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

const icons = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
  warn: TriangleAlert,
} as const;

const toneClasses = {
  default: "text-info",
  success: "text-ok",
  error: "text-live-soft",
  warn: "text-warn",
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (title: string, options?: { description?: string; tone?: ToastTone }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [
        ...current.slice(-3),
        { id, title, description: options?.description, tone: options?.tone ?? "default" },
      ]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, 4200);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[calc(100vw-2.5rem)] max-w-sm flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((item) => {
            const Icon = icons[item.tone];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line-strong bg-[#12151C] p-3.5 shadow-2xl"
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneClasses[item.tone])} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-ink">{item.title}</div>
                  {item.description ? (
                    <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                      {item.description}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
