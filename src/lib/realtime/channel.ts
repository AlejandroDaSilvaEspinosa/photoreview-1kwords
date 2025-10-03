// src/lib/realtime/channel.ts
"use client";
import { emitToast, toastError } from "@/hooks/useToast";
import { supabaseBrowser } from "@/lib/supabase/browser";

type RealtimeChannel = ReturnType<
  ReturnType<typeof supabaseBrowser>["channel"]
>;

type ConnectArgs = {
  channelName: string;
  onSetup: (ch: RealtimeChannel) => void; // SIEMPRE que se cree un canal nuevo
  onCatchUp?: () => Promise<void> | void; // se ejecuta en cada SUBSCRIBED
};

type StatusUX =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "subscribed"
  | "disconnected"
  | "error";

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

      // UX / Toasts
      lastStatus: StatusUX;
      lastToastAt: number;
      lastToastKey: string;
      toastCooldownMs: number;
    }
  >;
};

const getGlobal = (): GlobalRT => {
  const w = globalThis as any;
  if (!w.__rt_registry__) w.__rt_registry__ = { topics: new Map() } as GlobalRT;
  return w.__rt_registry__ as GlobalRT;
};

const humanDelay = (ms: number) => {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
};

export function connectWithBackoff({
  channelName,
  onSetup,
  onCatchUp,
}: ConnectArgs) {
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

      lastStatus: "idle",
      lastToastAt: 0,
      lastToastKey: "",
      toastCooldownMs: 4000,
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

  // Permite “forzar” reconexión desde el botón del toast
  const forceReconnect = () => {
    if (!rec || rec.cancelled) return;
    clearRetry();
    rec.retryMs = 1000;
    void connect();
  };

  const maybeToast = (input: {
    title: string;
    description?: string;
    variant?: "info" | "success" | "warning" | "error";
    durationMs?: number;
    actionLabel?: string;
    onAction?: () => void;
    thumbUrl?: string;
  }) => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }
    if (!rec) return;
    const now = Date.now();
    const key = `${input.variant ?? "info"}|${input.title}|${
      input.description ?? ""
    }`;
    const shouldEmit =
      key !== rec.lastToastKey || now - rec.lastToastAt > rec.toastCooldownMs;
    if (!shouldEmit) return;

    try {
      emitToast({
        title: input.title,
        description: input.description ?? "",
        variant: input.variant ?? "info",
        durationMs: input.durationMs ?? 6000,
        actionLabel: input.actionLabel ?? "",
        onAction: input.onAction,
        thumbUrl: input.thumbUrl ?? "",
        timeAgo: "", // lo gestionáis en el renderer si queréis
      });
      rec.lastToastKey = key;
      rec.lastToastAt = now;
    } catch {
      // No romper flujo de conexión si el sistema de toasts falla
    }
  };

  const setStatus = (s: StatusUX) => {
    if (!rec) return;
    rec.lastStatus = s;
  };

  const schedule = () => {
    if (!rec || rec.cancelled) return;
    clearRetry();

    // UX: avisar del reintento con backoff actual
    maybeToast({
      variant: "warning",
      title: `Conexión perdida en “${channelName}”`,
      description: `Reintentando en ${humanDelay(rec.retryMs)}…`,
      actionLabel: "Reintentar ahora",
      onAction: forceReconnect,
      durationMs: 7000,
    });

    rec.retryTimer = window.setTimeout(() => {
      connect().catch(() => {
        // si el intento falla silenciosamente, reprogramamos
        schedule();
      });
      rec!.retryMs = Math.min(15000, rec!.retryMs * 2);
    }, rec.retryMs) as unknown as number;

    setStatus("reconnecting");
  };

  const connect = async () => {
    if (!rec || rec.cancelled) return;
    if (rec.connecting || rec.subscribed) return; // 🔒 evita reentradas

    rec.connecting = true;
    setStatus("connecting");

    try {
      // borra canales previos con el mismo tópico (por si quedaron colgados)
      for (const c of sb.getChannels()) {
        if ((c as any).topic === channelName) sb.removeChannel(c);
      }

      const ch = sb.channel(channelName);
      rec.ch = ch;

      // Registrar handlers SIEMPRE que se crea un canal
      onSetup(ch);

      // NO await: subscribe no es una promesa
      ch.subscribe((status) => {
        if (!rec || rec.cancelled) return;

        if (status === "SUBSCRIBED") {
          rec.subscribed = true;
          rec.connecting = false;
          clearRetry();
          const recovered =
            rec.lastStatus === "reconnecting" ||
            rec.lastStatus === "connecting" ||
            rec.lastStatus === "error" ||
            rec.lastStatus === "disconnected";

          setStatus("subscribed");
          if (recovered) {
            maybeToast({
              variant: "success",
              title: `Reconectado a “${channelName}”`,
              description: "Conexión en tiempo real restaurada.",
              durationMs: 4000,
            });
          }

          // catch-up para TODOS los consumidores activos
          for (const fn of rec.runCatchUps) {
            try {
              void fn();
            } catch (e) {
              toastError(e, { title: `Error en catch-up de “${channelName}”` });
            }
          }
        } else if (status === "CHANNEL_ERROR") {
          rec.subscribed = false;
          rec.connecting = false;
          setStatus("error");
          maybeToast({
            variant: "error",
            title: `Error en “${channelName}”`,
            description: "Se intentará reconectar automáticamente…",
            actionLabel: "Reintentar ahora",
            onAction: forceReconnect,
          });
          schedule();
        } else if (status === "CLOSED" || status === "TIMED_OUT") {
          rec.subscribed = false;
          rec.connecting = false;
          setStatus("disconnected");
          maybeToast({
            variant: "warning",
            title: `Canal “${channelName}” desconectado (${status.toLowerCase()})`,
            description: "Reintentando conexión…",
            actionLabel: "Reintentar ahora",
            onAction: forceReconnect,
          });
          schedule();
        }
      });

      // listeners de foco/online solo una vez por tópico
      if (!rec.listenersBound) {
        const onVis = () => {
          if (!rec || rec.cancelled) return;
          if (document.visibilityState === "visible") {
            if (rec.subscribed) {
              rec.runCatchUps.forEach((f) => void f());
            } else {
              maybeToast({
                variant: "info",
                title: `Volviste a la app`,
                description: `Reintentando conexión a “${channelName}”…`,
                actionLabel: "Reintentar ahora",
                onAction: forceReconnect,
                durationMs: 4000,
              });
              void connect();
            }
          }
        };
        const onOnline = () => {
          if (!rec || rec.cancelled) return;
          if (rec.subscribed) {
            rec.runCatchUps.forEach((f) => void f());
          } else {
            maybeToast({
              variant: "info",
              title: "Conexión a internet restaurada",
              description: `Reconectando “${channelName}”…`,
              actionLabel: "Reintentar ahora",
              onAction: forceReconnect,
              durationMs: 4000,
            });
            void connect();
          }
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
    } catch (e) {
      setStatus("error");
      toastError(e, { title: `No se pudo abrir “${channelName}”` });
      schedule();
    } finally {
      if (rec) rec.connecting = false;
    }
  };

  // sube el refCount DESPUÉS de tener rec listo
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
      try {
        fn();
      } catch (e) {
        toastError(e, {
          title: `No se pudo limpiar listeners de “${channelName}”`,
        });
      }
    });
    current.cleanupFns = [];
    if (current.ch) {
      try {
        supabaseBrowser().removeChannel(current.ch);
      } catch (e) {
        // evitar romper el flujo si falla el remove
      }
    }
    g.topics.delete(channelName);

    // Aviso de cierre voluntario del último consumidor
    maybeToast({
      variant: "info",
      title: `Canal “${channelName}” cerrado`,
      description: "Se cerró porque ya no hay consumidores activos.",
      durationMs: 4000,
    });
  };
}
