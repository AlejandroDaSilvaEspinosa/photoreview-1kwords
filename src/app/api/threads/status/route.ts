import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

type NextStatus = "pending" | "corrected" | "reopened" | "deleted";

const STATUS_LABEL: Record<NextStatus, string> = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
};

export async function POST(req: Request) {
  const body = await req.json();
  const { threadId, status } = body as { threadId: number; status: NextStatus };

  if (!threadId || !status || !(status in STATUS_LABEL)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user?.name) return new NextResponse("No autorizado", { status: 401 });

  const sb = supabaseAdmin();

  // 1) Update estado del hilo
  const { error: e1 } = await sb
    .from("review_threads")
    .update({ status })
    .eq("id", threadId);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // 2) Asegurar usuario 'system' (mostrará "Sistema" en UI)
  const { data: sysUpsert, error: sysErr } = await sb
    .from("app_users")
    .upsert(
      { username: "system", display_name: "Sistema" },
      { onConflict: "username" }
    )
    .select("id, username, display_name")
    .single();

  if (sysErr || !sysUpsert) {
    return NextResponse.json(
      { error: "No se pudo crear/obtener el usuario system" },
      { status: 500 }
    );
  }

  // 3) Insertar mensaje de sistema (será lo que active realtime)
  const label = STATUS_LABEL[status];
  const text = `**@${user.name}** cambió el estado del hilo a "**${label}**".`;

  const { data: insertedMsg, error: e2 } = await sb
    .from("review_messages")
    .insert({
      thread_id: threadId,
      text,
      created_by: sysUpsert.id,
      is_system: true,
    })
    .select("id, created_at, text")
    .single();

  if (e2 || !insertedMsg) {
    return NextResponse.json({ error: e2?.message || "No se pudo crear el mensaje" }, { status: 500 });
  }

  // 4) Responder con los datos necesarios para reconciliar en cliente
  return NextResponse.json({
    ok: true,
    message: {
      id: insertedMsg.id,
      text: insertedMsg.text,
      createdAt: insertedMsg.created_at as string,
      createdByName: sysUpsert.display_name || "Sistema",
      isSystem: true,
    },
  });
}
