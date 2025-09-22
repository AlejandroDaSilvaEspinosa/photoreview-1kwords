import { NextResponse,NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sku, imageName, x, y } = body;

  const { client: sb, res } = supabaseFromRequest(req);

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });


  // ID del usuario actual (app_users)
  const { data: appUser, error: userError } = await sb
    .from("app_users")
    .select("id")
    .eq("username", user.user_metadata.display_name)
    .single();

  if (userError || !appUser) {
    console.error("Error obteniendo el ID del usuario:", userError);
    return NextResponse.json(
      { error: "Fallo al autenticar al usuario" },
      { status: 500 }
    );
  }

  const { data, error } = await sb
    .from("review_threads")
    .insert({
      sku,
      image_name: imageName,
      x,
      y,
      status: "pending",
      created_by: appUser.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error creando hilo en /api/threads:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

 //return NextResponse.json({ ok: true, data: [] }, { headers: res.headers });
  return NextResponse.json({ threadId: data.id });
}
