import { NextResponse, NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sku, imageName, x, y } = body;

  const { client: sb, res } = supabaseFromRequest(req);

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Usa SIEMPRE el auth.user.id como created_by (== app_users.id)
  const createdBy = user.id;

  const { data, error } = await sb
    .from("review_threads")
    .insert({
      sku,
      image_name: imageName,
      x,
      y,
      status: "pending",
      created_by: createdBy, // 👈 auth id == app_users.id
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error creando hilo en /api/threads:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ threadId: data.id });
}
