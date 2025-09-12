import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { id: number; text: string; createdAt: string };
type Thread = { id: number; x: number; y: number; messages: Msg[] };
type ReviewItem = {
  name: string | null;
  validated: boolean;
  url: string;
  annotations: Thread[];
};

export async function POST(req: Request) {
  const body = await req.json();
  const sku: { sku: string } = body?.sku;
  const review: ReviewItem[] = body?.review;

  if (!sku?.sku || !Array.isArray(review)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Usuario desde tu cookie JWT
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  const username = user?.name || "user";

  const sb = supabaseAdmin();

  // Upsert app_user si no existe
  const { data: upserUser, error: uerr } = await sb
    .from("app_users")
    .upsert({ username }, { onConflict: "username" })
    .select("id")
    .single();

  if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 });

  // Calcular next revision
  const { data: latest, error: e1 } = await sb
    .from("reviews")
    .select("revision")
    .eq("sku", sku.sku)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const nextRevision = (latest?.revision ?? 0) + 1;

  // Insert reviews (una por imagen)
  const rows = review
    .filter(r => r.name)
    .map(r => ({
      sku: sku.sku,
      image_name: r.name!,
      validated: !!r.validated,
      revision: nextRevision,
      created_by: upserUser.id,
    }));

  const { data: inserted, error: e2 } = await sb
    .from("reviews")
    .insert(rows)
    .select("id, image_name");

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Mapa image_name -> review_id
  const idByImage = Object.fromEntries(inserted.map(r => [r.image_name, r.id]));

  // Insert comments (flatten threads/messages)
  const comments = review.flatMap(r => {
    const rid = idByImage[r.name!];
    if (!rid) return [];
    return r.annotations.flatMap(th =>
      th.messages
        .filter(m => m.text?.trim())
        .map(m => ({
          review_id: rid,
          thread_key: String(th.id),
          x: th.x,
          y: th.y,
          text: m.text,
          created_by: upserUser.id,
          created_at: m.createdAt ?? new Date().toISOString(),
        }))
    );
  });

  if (comments.length) {
    const { error: e3 } = await sb.from("review_comments").insert(comments);
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
  }

  return NextResponse.json({ revision: nextRevision, ok: true });
}
