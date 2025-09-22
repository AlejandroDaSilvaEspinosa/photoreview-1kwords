import { NextResponse,NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {

  const { client: sb, res } = supabaseFromRequest(req);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });


  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });


  // (Si no tienes CASCADE en FK) borra mensajes primero
  const { error: e1 } = await sb.from("review_messages").delete().eq("thread_id", id);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  // Borra el hilo
  const { error: e2 } = await sb.from("review_threads").delete().eq("id", id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
 //return NextResponse.json({ ok: true, data: [] }, { headers: res.headers });
  return NextResponse.json({ ok: true });
}
