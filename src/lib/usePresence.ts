"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type PresenceUser = {
  id: string;
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  sessions: number; // cuántas pestañas del mismo usuario
};

/**
 * Reglas:
 * - La clave de presencia (key) = user.id (estable). Fallback: username o "guest:xxxxx".
 * - En track enviamos metadata (username, display_name, email) para que otros lo vean.
 * - En sync, deduplicamos por key y contamos nº de metas = sesiones.
 */
export function usePresence(room: string, username?: string) {
  const [online, setOnline] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();

    let channel: ReturnType<typeof sb.channel> | null = null;
    let mounted = true;

    (async () => {
      const { data } = await sb.auth.getUser();
      const user = data?.user ?? null;

      const id =
        user?.id ||
        (username ? `name:${username}` : null) ||
        `guest:${Math.random().toString(36).slice(2, 8)}`;

      const uname =
        (user?.user_metadata as any)?.user_name ||
        (user?.user_metadata as any)?.username ||
        username ||
        (user?.email ? user.email.split("@")[0] : null) ||
        "Anónimo";

      const display =
        (user?.user_metadata as any)?.full_name ||
        (user?.user_metadata as any)?.name ||
        uname;

      const email = user?.email || null;

      channel = sb.channel(`presence:${room}`, {
        config: { presence: { key: id } },
      });

      channel.on("presence", { event: "sync" }, () => {
        if (!mounted) return;
        const state = channel!.presenceState() as Record<string, any[]>;
        const map = new Map<string, PresenceUser>();
        Object.entries(state).forEach(([key, metas]) => {
          metas.forEach((m) => {
            const cur = map.get(key);
            if (cur) {
              cur.sessions += 1;
            } else {
              map.set(key, {
                id: key,
                username:
                  m.username ??
                  m.user_name ??
                  m.uname ??
                  m.profile?.username ??
                  null,
                displayName:
                  m.display_name ??
                  m.full_name ??
                  m.name ??
                  m.profile?.name ??
                  m.username ??
                  null,
                email: m.email ?? null,
                sessions: 1,
              });
            }
          });
        });
        setOnline(Array.from(map.values()));
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel!.track({
            username: uname,
            display_name: display,
            email,
            online_at: new Date().toISOString(),
          });
        }
      });
    })();

    return () => {
      mounted = false;
      if (channel) channel.unsubscribe();
    };
  }, [room, username]);

  return online;
}
