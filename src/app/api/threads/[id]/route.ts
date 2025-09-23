import { NextResponse, NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function DELETE(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const { id } = context.params;
  
  const { client: sb } = supabaseFromRequest(req);

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await sb.from("review_threads").delete().eq("id", Number.parseInt(id));

  if (error) {
    console.error("Error borrando hilo:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
