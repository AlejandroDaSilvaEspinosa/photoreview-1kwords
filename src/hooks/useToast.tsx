"use client";

import React, {createContext, useCallback, useContext, useMemo, useState} from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastInput = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number; // default 4000
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((t: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = {
      id,
      title: t.title ?? "",
      description: t.description ?? "",
      variant: t.variant ?? "info",
      durationMs: t.durationMs ?? 8000,
      actionLabel: t.actionLabel ?? "",
      onAction: t.onAction ?? (() => {}),
      createdAt: Date.now(),
    };
    setToasts(prev => [toast, ...prev]);

    // auto-dismiss
    window.setTimeout(() => dismiss(id), toast.durationMs);
  }, [dismiss]);

  const clear = useCallback(() => setToasts([]), []);

  const value = useMemo<Ctx>(() => ({ toasts, push, dismiss, clear }), [toasts, push, dismiss, clear]);

  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider/>");
  return ctx;
}
