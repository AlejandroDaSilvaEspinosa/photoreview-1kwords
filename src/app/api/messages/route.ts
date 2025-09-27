import { NextResponse, NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { threadId, text, isSystem } = body;

  const { client: sb, res } = supabaseFromRequest(req);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // map username -> app_users.id
  const { data: appUser, error: userError } = await sb
    .from("app_users")
    .select("id")
    .eq(
      "username",
      isSystem
        ? "system"
        : ((user?.user_metadata?.display_name as string) ?? user?.email),
    )
    .single();

  if (userError || !appUser) {
    console.error("Error obteniendo el ID del usuario:", userError);
    return NextResponse.json(
      { error: "Fallo al autenticar al usuario" },
      { status: 500 },
    );
  }

  const { data, error } = await sb
    .from("review_messages")
    .insert({
      thread_id: threadId,
      text,
      created_by: appUser.id,
      is_system: isSystem,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  //return NextResponse.json({ ok: true, data: [] }, { headers: res.headers });
  return NextResponse.json(data);
}
