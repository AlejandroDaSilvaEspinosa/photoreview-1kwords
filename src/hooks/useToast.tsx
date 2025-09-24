// src/hooks/useToast.tsx
"use client";

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastInput = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
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

  // ✅ control hover (pausar/reanudar todos)
  pausedAll: boolean;
  pauseAll: () => void;
  resumeAll: () => void;
};

const EVENT_NAME = "app:toast";

const ToastCtx = createContext<Ctx | null>(null);

const genId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type TimerState = { start: number; remaining: number; handle?: number };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<string, TimerState>>({});
  const [pausedAll, setPausedAll] = useState(false);

  const schedule = useCallback((id: string) => {
    const t = timersRef.current[id];
    if (!t) return;
    if (t.handle) window.clearTimeout(t.handle);
    t.start = Date.now();
    t.handle = window.setTimeout(() => dismiss(id), Math.max(0, t.remaining));
  }, []);

  const dismiss = useCallback((id: string) => {
    const t = timersRef.current[id];
    if (t?.handle) window.clearTimeout(t.handle);
    delete timersRef.current[id];
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = genId();
    const toast: Toast = {
      id,
      title: input.title ?? "",
      description: input.description ?? "",
      variant: input.variant ?? "info",
      durationMs: input.durationMs ?? 10000000,
      actionLabel: input.actionLabel ?? "",
      onAction: input.onAction ?? (() => {}),
      createdAt: Date.now(),
    };
    setToasts(prev => [toast,...prev]);

    timersRef.current[id] = { start: Date.now(), remaining: toast.durationMs };
    if (!pausedAll) schedule(id);
  }, [pausedAll, schedule]);

  const clear = useCallback(() => {
    Object.values(timersRef.current).forEach(t => t.handle && window.clearTimeout(t.handle));
    timersRef.current = {};
    setToasts([]);
  }, []);

  // ✅ Pausar/Reanudar TODOS (hover stack)
  const pauseAll = useCallback(() => {
    if (pausedAll) return;
    setPausedAll(true);
    const now = Date.now();
    for (const [id, t] of Object.entries(timersRef.current)) {
      if (t.handle) {
        window.clearTimeout(t.handle);
        t.handle = undefined;
      }
      t.remaining = Math.max(0, t.remaining - (now - t.start));
    }
  }, [pausedAll]);

  const resumeAll = useCallback(() => {
    if (!pausedAll) return;
    setPausedAll(false);
    for (const id of Object.keys(timersRef.current)) {
      schedule(id);
    }
  }, [pausedAll, schedule]);

  // Limpieza
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(t => t.handle && window.clearTimeout(t.handle));
      timersRef.current = {};
    };
  }, []);

  // ✅ Bus global: permite lanzar toasts desde cualquier sitio (incl. catch)
  useEffect(() => {
    const onBus = (e: Event) => {
      const ce = e as CustomEvent<ToastInput>;
      if (ce?.detail) push(ce.detail);
    };
    window.addEventListener(EVENT_NAME, onBus as EventListener);
    return () => window.removeEventListener(EVENT_NAME, onBus as EventListener);
  }, [push]);

  const value = useMemo<Ctx>(() => ({
    toasts, push, dismiss, clear, pausedAll, pauseAll, resumeAll
  }), [toasts, push, dismiss, clear, pausedAll, pauseAll, resumeAll]);

  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider/>");
  return ctx;
}

/* ===========================
   Helpers globales (no hooks)
   =========================== */

export function emitToast(t: ToastInput) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastInput>(EVENT_NAME, { detail: t }));
}

/** Para usar en catch(...) */
export function toastError(
  error: unknown,
  opts?: { title?: string; fallback?: string; durationMs?: number }
) {
  const title = opts?.title ?? "Error";
  let description = opts?.fallback ?? "Ha ocurrido un error inesperado.";
  try {
    if (error instanceof Error && error.message) description = error.message;
    else if (typeof error === "string" && error) description = error;
  } catch {
    console.log("error")
  }
  emitToast({ variant: "error", title, description, durationMs: opts?.durationMs ?? 6000 });
}
