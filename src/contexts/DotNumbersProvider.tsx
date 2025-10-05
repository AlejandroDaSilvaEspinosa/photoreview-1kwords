// ==============================
// File: src/contexts/DotNumbersProvider.tsx
// ==============================
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { pointKey } from "@/lib/common/coords";
import type { ThreadStatus } from "@/types/review";

/**
 * Calcula numeración estable 1..N por imagen:
 * - Seed por orden de id
 * - Incremental para puntos nuevos
 * - Reconstrucción 1..N si hay borrados (status === "deleted")
 */
type MinimalThread = { id: number; x: number; y: number; status: ThreadStatus };

type Ctx = {
  imageName: string | null;
  /** getNumber para coords de la imagen actual */
  getNumber: (x: number, y: number) => number | null;
  /** versión para invalidar memos en consumidores cuando cambian los números */
  version: number;
};

const DotNumbersCtx = createContext<Ctx | null>(null);

export function DotNumbersProvider({
  imageName,
  threads,
  children,
}: {
  imageName: string | null;
  threads: MinimalThread[];
  children: ReactNode;
}) {
  // Mapa solo para la imagen actual
  const mapRef = useRef<Map<string, number>>(new Map());
  const nextRef = useRef<number>(1);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!imageName) return;

    const current = threads.filter((t) => t.status !== "deleted");
    const currentKeys = new Set(
      current.map((t) => pointKey(imageName, t.x, t.y))
    );

    let didChange = false;

    // 1) Primera vez: sembramos 1..N por id
    if (mapRef.current.size === 0) {
      const sorted = current.slice().sort((a, b) => a.id - b.id);
      const fresh = new Map<string, number>();
      let i = 1;
      for (const t of sorted) fresh.set(pointKey(imageName, t.x, t.y), i++);
      mapRef.current = fresh;
      nextRef.current = i;
      didChange = true;
    } else {
      // 2) ¿Hubo removals? → reconstruimos 1..N
      let hasRemoval = false;
      for (const k of mapRef.current.keys()) {
        if (!currentKeys.has(k)) {
          hasRemoval = true;
          break;
        }
      }
      if (hasRemoval) {
        const sorted = current.slice().sort((a, b) => a.id - b.id);
        const rebuilt = new Map<string, number>();
        let i = 1;
        for (const t of sorted) rebuilt.set(pointKey(imageName, t.x, t.y), i++);
        mapRef.current = rebuilt;
        nextRef.current = i;
        didChange = true;
      } else {
        // 3) No removals → asignamos numeración a nuevas keys
        let localNext = nextRef.current ?? 1;
        for (const t of current) {
          const k = pointKey(imageName, t.x, t.y);
          if (!mapRef.current.has(k)) {
            mapRef.current.set(k, localNext++);
            didChange = true;
          }
        }
        if (didChange) nextRef.current = localNext;
      }
    }

    if (didChange) setVersion((v) => v + 1);
  }, [imageName, threads]);

  // Al cambiar de imagen, reseteamos el mapa
  useEffect(() => {
    mapRef.current = new Map();
    nextRef.current = 1;
    setVersion((v) => v + 1);
  }, [imageName]);

  const getNumber = useCallback(
    (x: number, y: number) => {
      if (!imageName) return null;
      return mapRef.current.get(pointKey(imageName, x, y)) ?? null;
    },
    [imageName, version] // version asegura que leemos el mapa actualizado
  );

  const ctxValue = useMemo<Ctx>(
    () => ({ imageName, getNumber, version }),
    [imageName, getNumber, version]
  );

  return (
    <DotNumbersCtx.Provider value={ctxValue}>{children}</DotNumbersCtx.Provider>
  );
}

export function useDotNumbers() {
  return useContext(DotNumbersCtx);
}
