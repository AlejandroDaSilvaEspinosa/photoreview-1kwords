"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type PresenceUser = { username: string };

export function usePresence(room: string, username: string | undefined) {
  const [online, setOnline] = useState<PresenceUser[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb.channel(`presence:${room}`, {
      config: { presence: { key: username } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const list: PresenceUser[] = [];
      Object.values(state).forEach((arr) => {
        (arr as any[]).forEach((m) => list.push({ username: m.key }));
      });
      setOnline(list);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        channel.track({ online_at: new Date().toISOString() });
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [room, username]);

  return online;
}

