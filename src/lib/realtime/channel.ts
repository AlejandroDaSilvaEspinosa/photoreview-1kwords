// src/lib/realtime/channel.ts
"use client";
import { toastError } from "@/hooks/useToast";
import { supabaseBrowser } from "@/lib/supabase/browser";

type RealtimeChannel = ReturnType<ReturnType<typeof supabaseBrowser>["channel"]>;

type ConnectArgs = {
  channelName: string;
  onSetup: (ch: RealtimeChannel) => void;  // SIEMPRE que se cree un canal nuevo
  onCatchUp?: () => Promise<void> | void;  // se ejecuta en cada SUBSCRIBED
};

type GlobalRT = {
  topics: Map<
    string,
    {
      ch: RealtimeChannel | null;
      refCount: number;
      subscribed: boolean;
      connecting: boolean;
      cancelled: boolean;
      retryMs: number;
      retryTimer: number | null;
      listenersBound: boolean; // foco/online
      runCatchUps: Set<() => Promise<void> | void>; // uno por consumidor
      cleanupFns: Array<() => void>;
    }
  >;
};

const getGlobal = (): GlobalRT => {
  const w = globalThis as any;
  if (!w.__rt_registry__) w.__rt_registry__ = { topics: new Map() } as GlobalRT;
  return w.__rt_registry__ as GlobalRT;
};

export function connectWithBackoff({ channelName, onSetup, onCatchUp }: ConnectArgs) {
  const sb = supabaseBrowser();
  const g = getGlobal();

  let rec = g.topics.get(channelName);
  if (!rec) {
    rec = {
      ch: null,
      refCount: 0,
      subscribed: false,
      connecting: false,
      cancelled: false,
      retryMs: 1000,
      retryTimer: null,
      listenersBound: false,
      runCatchUps: new Set(),
      cleanupFns: [],
    };
    g.topics.set(channelName, rec);
  }

  if (onCatchUp) rec.runCatchUps.add(onCatchUp);

  const clearRetry = () => {
    if (rec!.retryTimer != null) {
      clearTimeout(rec!.retryTimer!);
      rec!.retryTimer = null;
    }
  };

  const schedule = () => {
    if (!rec || rec.cancelled) return;
    clearRetry();
    rec.retryTimer = window.setTimeout(() => {
      connect().catch(() => schedule());
      rec!.retryMs = Math.min(15000, rec!.retryMs * 2);
    }, rec.retryMs) as unknown as number;
  };

  const connect = async () => {
    if (!rec || rec.cancelled) return;
    if (rec.connecting || rec.subscribed) return; // 🔒 evita reentradas

    rec.connecting = true;

    try {
      // borra canales previos con el mismo tópico (por si quedaron colgados)
      for (const c of sb.getChannels()) {
        if ((c as any).topic === channelName) sb.removeChannel(c);
      }

      const ch = sb.channel(channelName);
      rec.ch = ch;

      // ⬅️ MUY IMPORTANTE: registrar handlers SIEMPRE que se crea un canal
      onSetup(ch);

      // NO await: subscribe no es una promesa
      ch.subscribe((status) => {
        if (!rec || rec.cancelled) return;

        if (status === "SUBSCRIBED") {
          rec.subscribed = true;
          rec.connecting = false;
          clearRetry();
          rec.retryMs = 1000;

          // catch-up para TODOS los consumidores activos
          for (const fn of rec.runCatchUps) {
            try { void fn(); } catch {}
          }
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          rec.subscribed = false;
          rec.connecting = false;
          schedule();
        }
      });

      // listeners de foco/online solo una vez por tópico
      if (!rec.listenersBound) {
        const onVis = () => {
          if (!rec || rec.cancelled) return;
          if (document.visibilityState === "visible") {
            rec.subscribed ? rec.runCatchUps.forEach((f) => void f()) : void connect();
          }
        };
        const onOnline = () => {
          if (!rec || rec.cancelled) return;
          rec.subscribed ? rec.runCatchUps.forEach((f) => void f()) : void connect();
        };
        window.addEventListener("visibilitychange", onVis);
        window.addEventListener("focus", onVis);
        window.addEventListener("online", onOnline);
        rec.cleanupFns.push(() => {
          window.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("focus", onVis);
          window.removeEventListener("online", onOnline);
        });
        rec.listenersBound = true;
      }
    } finally {
      if (rec) rec.connecting = false;
    }
  };

  // ⬅️ sube el refCount DESPUÉS de tener rec listo (ya no afecta al setup)
  rec.refCount += 1;

  // arranca la conexión si aún no hay canal
  if (!rec.ch) void connect();

  // cleanup por consumidor
  return () => {
    const current = g.topics.get(channelName);
    if (!current) return;

    if (onCatchUp) current.runCatchUps.delete(onCatchUp);

    current.refCount -= 1;
    if (current.refCount > 0) return; // otros consumidores siguen usando el canal

    current.cancelled = true;
    clearRetry();
    current.cleanupFns.forEach((fn) => {
      try { fn(); } catch {
        toastError(`no se pudo reconectar al canal ${channelName}` )
      }
    });
    current.cleanupFns = [];
    if (current.ch) supabaseBrowser().removeChannel(current.ch);
    g.topics.delete(channelName);
  };
}
