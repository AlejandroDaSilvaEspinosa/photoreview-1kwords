import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { unstable_noStore as noStore } from "next/cache";
import { Thread , ThreadMessage } from "@/types/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


type Payload = Record<string, { points: Thread[] }>;

export async function GET(
  _req: Request,
  { params }: { params: { sku: string } }
) {
  noStore();
  const sku = decodeURIComponent(params.sku);
  const sb = supabaseAdmin();

  // Threads del SKU
  const { data: threads, error: e1 } = await sb
    .from("review_threads")
    .select(
      "id, sku, image_name, x, y, status, created_by:app_users(username, display_name)"
    )
    .eq("sku::text", sku)
    .order("id", { ascending: true });

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!threads?.length) return NextResponse.json({}, { status: 200 });

  const threadIds = threads.map((t) => t.id);

  // Mensajes de esos threads
  const { data: messages, error: e2 } = await sb
    .from("review_messages")
    .select(
      "id, thread_id, text, created_at, created_by:app_users(username, display_name)"
    )
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  const msgsByThread = new Map<number, ThreadMessage[]>();
  for (const m of messages ?? []) {
    const arr = msgsByThread.get(m.thread_id) ?? [];
    arr.push({
      id: m.id,
      text: m.text,
      createdAt: m.created_at,
      createdByName: m.created_by?.display_name || m.created_by?.username,
      isSystem: (m.created_by?.username || "").toLowerCase() === "system",
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
