import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ThreadMsg = { id: number; text: string; createdAt: string; createdByName?: string };
type Thread = { id: number; x: number; y: number; messages: ThreadMsg[] };
type Payload = Record<string, { points: Thread[] }>;

export async function GET(
  _req: Request,
  { params }: { params: { sku: string } }
) {
  const sku = decodeURIComponent(params.sku);
  const sb = supabaseAdmin();

  // 1) encontrar última revision
  const { data: latest, error: e1 } = await sb
    .from("reviews")
    .select("revision")
    .eq("sku", sku)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!latest) return NextResponse.json({}, { status: 200 });

  // 2) leer reviews de esa revision
  const { data: revRows, error: e2 } = await sb
    .from("reviews")
    .select("id, image_name, validated, created_at, created_by:app_users(username, display_name)")
    .eq("sku", sku)
    .eq("revision", latest.revision);

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  const reviewIds = revRows.map(r => r.id);

  if (reviewIds.length === 0) return NextResponse.json({}, { status: 200 });

  // 3) comentarios
  const { data: comments, error: e3 } = await sb
    .from("review_comments")
    .select("review_id, thread_key, x, y, text, created_at, created_by:app_users(username, display_name)")
    .in("review_id", reviewIds)
    .order("created_at", { ascending: true });

  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

  // 4) ensamblar payload: { [image_name]: { points: Thread[] } }
  const byImage: Payload = {};
  const byReviewId = Object.fromEntries(revRows.map(r => [r.id, r.image_name]));

  const groups = new Map<string, Thread>(); // key = review_id + '|' + thread_key
  for (const c of comments ?? []) {
    const key = `${c.review_id}|${c.thread_key}`;
    let t = groups.get(key);
    if (!t) {
      t = {
        id: Number(c.thread_key) || Date.now(), // back-compat
        x: Number(c.x),
        y: Number(c.y),
        messages: [],
      };
      groups.set(key, t);
    }
    t.messages.push({
      id: Math.floor(new Date(c.created_at).getTime() / 1000),
      text: c.text,
      createdAt: c.created_at,
      createdByName: c.created_by?.display_name || c.created_by?.username || "Usuario",
    });
  }

  for (const [key, thread] of groups) {
    const reviewId = key.split("|")[0];
    const imageName = byReviewId[reviewId];
    if (!imageName) continue;
    if (!byImage[imageName]) byImage[imageName] = { points: [] };
    byImage[imageName].points.push(thread);
  }

  return NextResponse.json(byImage);
}
