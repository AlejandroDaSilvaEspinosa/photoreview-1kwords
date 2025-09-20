// src/hooks/useToast.tsx
"use client";

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastInput = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;   // p.ej. 4000 por defecto
  actionLabel?: string;
  onAction?: () => void;
};

export type Toast = Required<Omit<ToastInput, "durationMs">> & {
  id: string;
  createdAt: number;
  durationMs: number;
};

type Ctx = {
  toasts: Toast[];
  push: (t: ToastInput) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastCtx = createContext<Ctx | null>(null);

const genId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto)
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    // limpia timeout si existe
    const t = timersRef.current[id];
    if (t) {
      window.clearTimeout(t);
      delete timersRef.current[id];
    }
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const push = useCallback((t: ToastInput) => {
    const id = genId();
    const toast: Toast = {
      id,
      title: t.title ?? "",
      description: t.description ?? "",
      variant: t.variant ?? "info",
      durationMs: t.durationMs ?? 4000, // <- duración sensata por defecto
      actionLabel: t.actionLabel ?? "",
      onAction: t.onAction ?? (() => {}),
      createdAt: Date.now(),
    };

    setToasts(prev => [toast, ...prev]);

    // auto-dismiss con cleanup
    const handle = window.setTimeout(() => dismiss(id), toast.durationMs);
    timersRef.current[id] = handle;
  }, [dismiss]);

  const clear = useCallback(() => {
    // cancela todos los timeouts
    Object.values(timersRef.current).forEach(h => window.clearTimeout(h));
    timersRef.current = {};
    setToasts([]);
  }, []);

  useEffect(() => {
    // cleanup al desmontar el provider
    return () => {
      Object.values(timersRef.current).forEach(h => window.clearTimeout(h));
      timersRef.current = {};
    };
  }, []);

  const value = useMemo<Ctx>(() => ({ toasts, push, dismiss, clear }), [toasts, push, dismiss, clear]);

  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider/>");
  return ctx;
}
