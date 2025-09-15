import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { threadId, text, isSystem } = body;

  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const sb = supabaseAdmin();

  // map username -> app_users.id
  const { data: appUser, error: userError } = await sb
    .from("app_users")
    .select("id")
    .eq("username", isSystem ? "system" : user.name)
    .single();

  if (userError || !appUser) {
    console.error("Error obteniendo el ID del usuario:", userError);
    return NextResponse.json(
      { error: "Fallo al autenticar al usuario" },
      { status: 500 }
    );
  }

  const { data, error } = await sb
    .from("review_messages")
    .insert({
      thread_id: threadId,
      text,
      created_by: appUser.id,
      is_system: isSystem
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
