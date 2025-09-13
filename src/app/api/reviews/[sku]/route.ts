import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { unstable_noStore as noStore } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { id: number; text: string; createdAt: string; createdByName?: string };
type Thread = { id: number; x: number; y: number; status: "pending"|"corrected"|"reopened"; messages: Msg[] };
type Payload = Record<string, { points: Thread[] }>; // points = threads por imagen

export async function GET(_req: Request, { params }: { params: { sku: string } }
) {
  noStore();
  const {sku} = params
  const sb = supabaseAdmin();

  // Trae todos los threads del SKU
  console.log(sku)
  const { data: threads, error: e1 } = await sb
    .from("review_threads")
    .select("id, sku, image_name, x, y, status")
    .eq('sku::text', sku) // Comparación case-insensitive y trim
    .order("id", { ascending: true });
  console.log(threads)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!threads?.length) return NextResponse.json({}, { status: 200 });
  // Trae todos los mensajes de esos threads
  const threadIds = threads.map(t => t.id);
  const { data: messages, error: e2 } = await sb
    .from("review_messages")
    .select("id, thread_id, text, created_at, created_by:app_users(username, display_name)")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });
  console.log(messages)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  const msgsByThread = new Map<number, Msg[]>();
  for (const m of messages ?? []) {
    const arr = msgsByThread.get(m.thread_id) ?? [];
    arr.push({
      id: m.id,
      text: m.text,
      createdAt: m.created_at,
      createdByName: m.created_by?.display_name || m.created_by?.username || "Usuario",
    });
    msgsByThread.set(m.thread_id, arr);
  }

  const byImage: Payload = {};
  for (const t of threads) {
    const thread: Thread = {
      id: t.id,
      x: Number(t.x),
      y: Number(t.y),
      status: t.status,
      messages: msgsByThread.get(t.id) ?? [],
    };
    if (!byImage[t.image_name]) byImage[t.image_name] = { points: [] };
    byImage[t.image_name].points.push(thread);
  }

  return NextResponse.json(byImage);
}
