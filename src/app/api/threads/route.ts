import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME, UserPayload } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json();
  const { sku, imageName, x, y } = body;

  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user: UserPayload | null = token ? verifyToken(token) : null;
  if (!user?.name) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const sb = supabaseAdmin();

  // ID del usuario actual (app_users)
  const { data: appUser, error: userError } = await sb
    .from("app_users")
    .select("id")
    .eq("username", user.name)
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


  return NextResponse.json({ threadId: data.id });
}
