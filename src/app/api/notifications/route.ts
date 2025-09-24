// GET: lista + unseen_count, con paginación por cursor (?before=<ISO8601>)
import { NextRequest, NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

export async function GET(req: NextRequest) {
  const { client: sb } = supabaseFromRequest(req);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ items: [], unseen: 0, next: null, has_more: false }, { status: 200 });

  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? 30)));
  const before = searchParams.get("before"); // ISO8601 string (created_at)

  let q = sb
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (before) {
    // Trae “más antiguas” que el cursor recibido
    q = q.lt("created_at", before);
  }

  const { data: itemsRaw, error } = await q.limit(limit);
  if (error) {
    return NextResponse.json({ items: [], unseen: 0, next: null, has_more: false }, { status: 200 });
  }

  const items = itemsRaw ?? [];
  const last = items[items.length - 1] ?? null;

  // unseen total (independiente de paginación)
  const { count: unseen } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("viewed", false);

  return NextResponse.json({
    items,
    unseen: unseen ?? 0,
    next: last ? last.created_at : null,     // nuevo cursor
    has_more: (items.length === limit),      // simple heurística
  });
}

export async function PATCH(req: NextRequest) {
  const { client: sb } = supabaseFromRequest(req);
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
