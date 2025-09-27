import { NextRequest, NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";
// Ajusta la ruta del tipo generado:
import type { Database } from "@/lib/supabase/types";

// Alias de ayuda para el tipo de insert de la tabla
type ReviewMessageInsert =
  Database["public"]["Tables"]["review_messages"]["Insert"];

type InMsg = {
  clientNonce: string;
  threadId: number;
  text: string;
  isSystem?: boolean;
  createdAt?: string; // opcional (lo mandas desde outbox)
};

type BatchBody = { messages: InMsg[] } | InMsg; // soporte “single” por compatibilidad

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);

  // ---- Auth
  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- Parse
  const body = (await req.json().catch(() => ({}))) as BatchBody;
  const batch: InMsg[] = Array.isArray((body as any).messages)
    ? (body as any).messages
    : [body as InMsg];

  if (!batch.length) {
    return NextResponse.json({ error: "Empty payload" }, { status: 400 });
  }

  // ---- Resolver autor “normal” (app_users.id)
  //   Usamos display_name (o email) como username de negocio, igual que hacías antes.
  const username =
    (user.user_metadata?.display_name as string | undefined) ??
    user.email ??
    "";
  const { data: appUser, error: mapErr } = await sb
    .from("app_users")
    .select("id, display_name, username")
    .eq("username", username)
    .single();

  if (mapErr || !appUser) {
    return NextResponse.json(
      { error: "Fallo al autenticar al usuario de aplicación" },
      { status: 500 }
    );
  }

  // ---- Si hay algún mensaje de sistema en el batch, obtenemos el user system una sola vez
  let sysUserId: string | null = null;
  if (batch.some((m) => !!m.isSystem)) {
    const { data: sysUser, error: sysErr } = await sb.rpc("ensure_system_user");
    if (sysErr || !sysUser?.id) {
      return NextResponse.json(
        { error: "No se pudo crear/obtener el usuario system" },
        { status: 500 }
      );
    }
    sysUserId = String(sysUser.id);
  }

  // ---- Validación básica + construcción de payloads tipados
  const inserts: ReviewMessageInsert[] = [];
  const nonceOrder: string[] = []; // Para reconstruir el orden en la respuesta

  for (const m of batch) {
    if (
      !m ||
      typeof m.threadId !== "number" ||
      !Number.isFinite(m.threadId) ||
      m.threadId <= 0
    ) {
      return NextResponse.json({ error: "threadId inválido" }, { status: 400 });
    }
    if (typeof m.text !== "string") {
      return NextResponse.json({ error: "text inválido" }, { status: 400 });
    }
    if (!m.clientNonce || typeof m.clientNonce !== "string") {
      return NextResponse.json(
        { error: "clientNonce requerido" },
        { status: 400 }
      );
    }

    // created_by SIEMPRE como string (tus tipos lo piden así)
    const createdBy: string =
      m.isSystem && sysUserId ? sysUserId : String(appUser.id);

    // Construimos el payload con el tipo Insert generado por Supabase
    const row: ReviewMessageInsert = {
      thread_id: m.threadId,
      text: m.text,
      created_by: createdBy,
      is_system: !!m.isSystem,
      client_nonce: m.clientNonce, // string | null en tipos → ya es string
      // si quieres respetar una fecha llegada del cliente:
      ...(m.createdAt ? { created_at: m.createdAt } : null),
    };

    inserts.push(row);
    nonceOrder.push(m.clientNonce);
  }

  // ------------------------------------------------------------------
  // NOTA IMPORTANTE si tus tipos generados están desactualizados:
  // Si aquí TypeScript te dice que `thread_id` “no existe” en Insert,
  // regenera los tipos (supabase gen types …).
  // Mientras, puedes desactivar SOLO esta inserción con `as any`:
  //
  // const { data, error } = await sb
  //   .from("review_messages")
  //   .insert(inserts as any)
  //   .select("id, thread_id, text, created_at, created_by, is_system")
  //   .returns<{
  //     id: number;
  //     thread_id: number;
  //     text: string;
  //     created_at: string;
  //     created_by: string;
  //     is_system: boolean;
  //   }[]>();
  //
  // ------------------------------------------------------------------

  const { data, error } = await sb
    .from("review_messages")
    .insert(inserts)
    .select(
      `
      id,
      thread_id,
      text,
      created_at,
      created_by,
      is_system,
      created_by_username,
      created_by_display_name
    `
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mapear por clientNonce en el MISMO orden que envió el cliente
  // Usamos una búsqueda sencilla: cada insert corresponde al mismo índice.
  // (Si tu DB reordena por triggers, podrías necesitar una correlación más sólida.)
  const results = nonceOrder.map((nonce, i) => {
    const row = data?.[i];
    if (!row) {
      return { clientNonce: nonce, error: "Falta confirmación del servidor" };
    }
    return {
      clientNonce: nonce,
      row,
    };
  });

  return NextResponse.json({ results }, { headers: res.headers });
}
