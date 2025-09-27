import { NextResponse, NextRequest } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";
import { unstable_noStore as noStore } from "next/cache";
import type { Thread, ThreadStatus, DeliveryState } from "@/types/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = Record<string, { points: Thread[] }>;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sku: string }> },
) {
  noStore();

  const { sku } = await ctx.params;
  const decodedSku = decodeURIComponent(sku);

  const { client: sb, res } = supabaseFromRequest(req);

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Threads del SKU
  const { data: threads, error: e1 } = await sb
    .from("review_threads")
    .select(
      `
        id, 
        sku,
        image_name,
        x,
        y,
        status,        
        messages:review_messages!inner(
          id,          
          text,
          createdAt:created_at,
          isSystem:is_system,
          createdByName:app_users!review_messages_created_by_fkey(display_name),
          meta:review_message_receipts!review_message_receipts_message_fkey(
            user_id,
            delivered_at,
            read_at
          )
        )
      `,
    )
    .eq("sku", decodedSku)
    .not("status", "eq", "deleted")
    .order("id", { ascending: true });
  if (e1)
    return NextResponse.json(
      { error: threads },
      { status: 500, headers: res.headers },
    );

  if (!threads?.length)
    return NextResponse.json({}, { status: 200, headers: res.headers });

  const byImage: Payload = {};
  for (const t of threads) {
    const thread: Thread = {
      id: t.id,
      x: Number(t.x),
      y: Number(t.y),
      status: t.status as ThreadStatus,
      messages: t.messages.map((m) => {
        const receipt = m.meta || [];
        const localDelivery: DeliveryState = receipt.some((r) => r.read_at)
          ? "read"
          : receipt.some((r) => r.delivered_at)
            ? "delivered"
            : "sent";

        return {
          id: m.id,
          createdAt: m.createdAt,
          text: m.text,
          createdByName: m.createdByName?.display_name ?? "desconocido",
          isSystem: m.isSystem,
          meta: {
            localDelivery: localDelivery,
          },
        };
      }),
    };
    (byImage[t.image_name] ||= { points: [] }).points.push(thread);
  }

  return NextResponse.json(byImage, { headers: res.headers });
}
