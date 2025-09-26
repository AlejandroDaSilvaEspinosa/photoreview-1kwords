// src/lib/realtime/pg.ts
// Azúcar para suscripciones Postgres en canales Realtime.
type Event = "INSERT" | "UPDATE" | "DELETE" | "*";

export function onTable<T>(
  ch: any, // RealtimeChannel
  table: string,
  handler: (evt: Event, row: T) => void,
  opts?: { schema?: string; filter?: string; event?: Event }
) {
  const { schema = "public", filter, event = "*" } = opts || {};
  ch.on(
    "postgres_changes",
    { event, schema, table, ...(filter ? { filter } : {}) },
    (p: any) => {
      const evt = p.eventType as Event;
      const row = (evt === "DELETE" ? p.old : p.new) as T | null;
      if (!row) return;
      handler(evt, row);
    }
  );
  return ch;
}
