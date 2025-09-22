// GET: lista + unseen_count
// PATCH: marcar "viewed" (ids o all=true)
import { NextRequest, NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function GET(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ items: [], unseen: 0 }, { status: 200 });

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? 30);

  const { data: items } = await sb
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  const { count: unseen } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("viewed", false);

  return NextResponse.json({ items: items ?? [], unseen: unseen ?? 0 });
}

export async function PATCH(req: NextRequest) {
 const { client: sb, res } = supabaseFromRequest(req);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true }, { status: 200 });

  const body = await req.json().catch(() => ({}));
  if (body?.all === true) {
    await sb.from("notifications").update({ viewed: true }).eq("user_id", user.id).eq("viewed", false);
    return NextResponse.json({ ok: true });
  }

  const ids: number[] = Array.isArray(body?.ids) ? body.ids : [];
  if (ids.length) {
    await sb.from("notifications").update({ viewed: true }).in("id", ids).eq("user_id", user.id);
  }
  return NextResponse.json({ ok: true });
}
