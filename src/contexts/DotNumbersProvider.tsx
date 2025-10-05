"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { pointKey } from "@/lib/common/coords";
import type { ThreadStatus } from "@/types/review";

type NumThread = { id: number; x: number; y: number; status: ThreadStatus };

type DotNumbersCtx = {
  /** aumenta cuando hay cambios de numeración/sync para facilitar dependencias */
  version: number;
  /** Sincroniza el estado interno de numeración para una imagen */
  sync: (imageName: string | null, threads: NumThread[]) => void;
  /** Obtiene el número para (x,y) de la imagen actual (la última usada en sync) */
  getNumber: (x: number, y: number) => number | null;
  /** Obtiene el número para (x,y) de una imagen concreta */
  getNumberFor: (imageName: string, x: number, y: number) => number | null;
  /** Resetea el mapa de una imagen (opcional) */
  resetForImage: (imageName: string) => void;
};

const Ctx = createContext<DotNumbersCtx | null>(null);

export function DotNumbersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // imagen -> (key -> numero)
  const mapsRef = useRef<Map<string, Map<string, number>>>(new Map());
  // imagen -> siguiente número a asignar
  const nextRef = useRef<Map<string, number>>(new Map());
  // imagen "actual" (último sync)
  const currentImageRef = useRef<string | null>(null);

  // Para provocar re-render en consumidores que dependan de la numeración
  const [version, setVersion] = useState(0);

  const sync = useCallback((imageName: string | null, threads: NumThread[]) => {
    if (!imageName) return;

    currentImageRef.current = imageName;

    const current = threads.filter((t) => t.status !== "deleted");
    const currentKeys = new Set(
      current.map((t) => pointKey(imageName, t.x, t.y))
    );

    let map = mapsRef.current.get(imageName);
    const prevNext = nextRef.current.get(imageName);

    // Primera vez: 1..N por id ascendente
    if (!map) {
      map = new Map<string, number>();
      const sorted = current.slice().sort((a, b) => a.id - b.id);
      let i = 1;
      for (const t of sorted) {
        map.set(pointKey(imageName, t.x, t.y), i++);
      }
      mapsRef.current.set(imageName, map);
      nextRef.current.set(imageName, i);
      setVersion((v) => v + 1);
      return;
    }

    // Detectar eliminaciones (keys del mapa que ya no existen)
    let hasRemoval = false;
    for (const k of map.keys()) {
      if (!currentKeys.has(k)) {
        hasRemoval = true;
        break;
      }
    }

    if (hasRemoval) {
      // Reconstruir 1..N por id ascendente para compactar huecos
      const rebuilt = new Map<string, number>();
      const sorted = current.slice().sort((a, b) => a.id - b.id);
      let i = 1;
      for (const t of sorted) {
        rebuilt.set(pointKey(imageName, t.x, t.y), i++);
      }
      mapsRef.current.set(imageName, rebuilt);
      nextRef.current.set(imageName, i);
      setVersion((v) => v + 1);
      return;
    }

    // Sin eliminaciones → asignar números a posibles puntos nuevos
    let localNext = typeof prevNext === "number" ? prevNext : 1;
    let changed = false;
    for (const t of current) {
      const key = pointKey(imageName, t.x, t.y);
      if (!map.has(key)) {
        map.set(key, localNext++);
        changed = true;
      }
    }
    if (changed) {
      nextRef.current.set(imageName, localNext);
      setVersion((v) => v + 1);
    }
  }, []);

  const getNumberFor = useCallback(
    (imageName: string, x: number, y: number) => {
      const map = mapsRef.current.get(imageName);
      if (!map) return null;
      const n = map.get(pointKey(imageName, x, y));
      return n ?? null;
    },
    []
  );

  const getNumber = useCallback(
    (x: number, y: number) => {
      const img = currentImageRef.current;
      if (!img) return null;
      return getNumberFor(img, x, y);
    },
    [getNumberFor]
  );

  const resetForImage = useCallback((img: string) => {
    mapsRef.current.delete(img);
    nextRef.current.delete(img);
    setVersion((v) => v + 1);
  }, []);

  const value: DotNumbersCtx = {
    version,
    sync,
    getNumber,
    getNumberFor,
    resetForImage,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDotNumbers() {
  return useContext(Ctx);
}
