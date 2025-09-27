// src/lib/storage.ts
"use client";

import { emitToast } from "@/hooks/useToast";

/** Utilidades comunes de almacenamiento + helpers. */
const warned = new Set<string>();

export const toastStorageOnce = (action: string) => {
  if (warned.has(action)) return;
  warned.add(action);
  emitToast({
    variant: "warning",
    title: "Almacenamiento limitado",
    description: `No se pudo ${action}. Algunos datos podrían no persistirse en este dispositivo.`,
    durationMs: 7000,
  });
};

export const safeParse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const persistIdle = (fn: () => void) => {
  const anyWin = window as Window;
  anyWin?.requestIdleCallback
    ? anyWin.requestIdleCallback(fn)
    : setTimeout(fn, 0);
};

export const localGet = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    toastStorageOnce(`leer el dato "${key}" de almacenamiento`);
    return null;
  }
};

export const localSet = (key: string, value: string, useIdle = true) => {
  const write = () => {
    try {
      localStorage.setItem(key, value);
    } catch {
      toastStorageOnce(`guardar el dato "${key}" en el dispositivo`);
    }
  };
  useIdle ? persistIdle(write) : write();
};

export const localRemove = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    toastStorageOnce(`eliminar el dato "${key}" del dispositivo`);
  }
};

export const sessionGet = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    toastStorageOnce(`acceder a datos de sesión ("${key}")`);
    return null;
  }
};

export const sessionSet = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    toastStorageOnce(`registrar datos de sesión ("${key}")`);
  }
};

/* ===== Helpers JSON tipados (nuevo) ===== */

export const localGetJSON = <T>(
  key: string,
  fallback: T | null = null,
): T | null => {
  const raw = localGet(key);
  const parsed = safeParse<T>(raw);
  return parsed ?? fallback;
};

export const localSetJSON = (key: string, value: unknown, useIdle = true) => {
  try {
    const str = JSON.stringify(value);
    localSet(key, str, useIdle);
  } catch {
    // JSON.stringify puede fallar en estructuras circulares
    toastStorageOnce(`serializar y guardar el dato "${key}" en el dispositivo`);
  }
};

export const sessionGetJSON = <T>(
  key: string,
  fallback: T | null = null,
): T | null => {
  try {
    const raw = sessionGet(key);
    const parsed = safeParse<T>(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

export const sessionSetJSON = (key: string, value: unknown) => {
  try {
    sessionSet(key, JSON.stringify(value));
  } catch {
    toastStorageOnce(`serializar y registrar datos de sesión ("${key}")`);
  }
};
