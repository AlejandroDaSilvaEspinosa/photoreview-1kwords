import { NextResponse, NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";
import { unstable_noStore as noStore } from "next/cache";
import { Thread, ThreadMessage } from "@/types/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = Record<string, { points: Thread[] }>;

export async function GET(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  noStore();
  const sku = decodeURIComponent(params.sku);
  const { client: sb, res } = supabaseFromRequest(req);

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Threads del SKU
  const { data: threads, error: e1 } = await sb
    .from("review_threads")
    .select(
      "id, sku, image_name, x, y, status, created_by:app_users(username, display_name)"
    )
    .eq("sku", sku)
    .order("id", { ascending: true });
  console.log(e1)

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500, headers: res.headers });
  if (!threads?.length) return NextResponse.json({}, { status: 200, headers: res.headers });

  const threadIds = threads.map((t) => t.id);

  // Mensajes de esos threads
  const { data: messages, error: e2 } = await sb
    .from("review_messages")
    .select(
      "id, thread_id, text, created_at, created_by:app_users!review_messages_created_by_fkey (username, display_name)"
    )
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });
  console.log(e2)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500, headers: res.headers });

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

  return NextResponse.json(byImage, { headers: res.headers });
}
