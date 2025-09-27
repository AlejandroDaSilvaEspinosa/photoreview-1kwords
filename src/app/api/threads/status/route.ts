import { NextResponse, NextRequest } from "next/server";

import { supabaseFromRequest } from "@/lib/supabase/route";

type NextStatus = "pending" | "corrected" | "reopened" | "deleted";

const STATUS_LABEL: Record<NextStatus, string> = {
  pending: "Pendiente",
  corrected: "Corregido",
  reopened: "Reabierto",
  deleted: "Eliminado",
};

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { threadId, status } = body as { threadId: number; status: NextStatus };

  if (!threadId || !status || !(status in STATUS_LABEL)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  // 1) Update estado del hilo
  const { error: e1 } = await sb
    .from("review_threads")
    .update({ status })
    .eq("id", threadId);
  console.log(e1);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // 2) Asegurar usuario 'system' (mostrará "Sistema" en UI)
  const { data: sysUser, error: rcpErr } = await sb.rpc("ensure_system_user");
  if (rcpErr || !sysUser) {
    return NextResponse.json(
      { error: "No se pudo crear/obtener el usuario system" },
      { status: 500 },
    );
  }
  console.log(sysUser);

  // 3) Insertar mensaje de sistema (será lo que active realtime)
  const label = STATUS_LABEL[status];
  const text = `**@${user.user_metadata.display_name}** cambió el estado del hilo a "**${label}**".`;
  const { data: insertedMsg, error: e2 } = await sb
    .from("review_messages")
    .insert({
      thread_id: threadId,
      text,
      created_by: sysUser.id,
      is_system: true,
    })
    .select("id, created_at, text")
    .single();

  if (e2 || !insertedMsg) {
    return NextResponse.json(
      { error: e2?.message || "No se pudo crear el mensaje" },
      { status: 500 },
    );
  }

  // 4) Responder con los datos necesarios para reconciliar en cliente
  return NextResponse.json(
    {
      ok: true,
      message: {
        id: insertedMsg.id,
        text: insertedMsg.text,
        createdAt: insertedMsg.created_at as string,
        createdByName: sysUser.display_name || "Sistema",
        isSystem: true,
      },
    },
    { headers: res.headers },
  );
}
