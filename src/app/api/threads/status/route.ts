import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

type NextStatus = "pending" | "corrected" | "reopened" | "deleted";

export async function POST(req: Request) {
  const body = await req.json();
  const { threadId, status } = body as { threadId: number; status: NextStatus };

  if (!threadId || !status) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user?.name) return new NextResponse("No autorizado", { status: 401 });

  const sb = supabaseAdmin();

  // Update estado
  const { error: e1 } = await sb
    .from("review_threads")
    .update({ status })
    .eq("id", threadId);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // Asegurar usuario 'system'
  const { data: sysUpsert, error: sysErr } = await sb
    .from("app_users")
    .upsert(
      { username: "system", display_name: "system"},
      { onConflict: "username" }
    )
    .select("id, username")
    .single();

  if (sysErr || !sysUpsert) {
    return NextResponse.json(
      { error: "No se pudo crear/obtener el usuario system" },
      { status: 500 }
    );
  }

  // Insertar mensaje de sistema con el cambio y autor real
  const text = `**@${user.name}** cambió el estado del hilo a "**${status === "corrected"
                      ? "Corregido"
                      : status === "reopened"
                      ? "Reabierto": ""}**".`;
  const { error: e2 } = await sb.from("review_messages").insert({
    thread_id: threadId,
    text,
    created_by: sysUpsert.id, // authored by 'system'
    is_system: true
  });

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
