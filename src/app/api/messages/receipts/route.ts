// src/app/api/messages/receipts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseFromRequest } from "@/lib/supabase/route";

type Body = { messageIds: number[]; mark: "delivered" | "read" };

export async function POST(req: NextRequest) {
  const { client: sb, res } = supabaseFromRequest(req);
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: res.headers },
    );

  const body = (await req.json()) as Body;
  const ids = Array.from(new Set(body?.messageIds || [])).filter((n) =>
    Number.isFinite(n),
  );
  if (!ids.length || !["delivered", "read"].includes(body.mark)) {
    return NextResponse.json(
      { error: "Bad request" },
      { status: 400, headers: res.headers },
    );
  }

  // Filtra mensajes propios: sólo marcamos recibos de mensajes AJENOS
  const { data: msgs, error: msgsErr } = await sb
    .from("review_messages")
    .select("id, created_by")
    .in("id", ids);

  if (msgsErr) {
    return NextResponse.json(
      { error: msgsErr.message },
      { status: 500, headers: res.headers },
    );
  }

  const targetIds = (msgs || [])
    .filter((m) => m.created_by !== user.id)
    .map((m) => m.id);

  if (!targetIds.length) {
    return NextResponse.json(
      { ok: true, updated: 0 },
      { headers: res.headers },
    );
  }

  const now = new Date().toISOString();

  // Paso 1: UPSERT para garantizar fila (delivered siempre presente)
  const upsertPayload = targetIds.map((id) => ({
    message_id: id,
    user_id: user.id, // auth uid
    delivered_at: now,
    // NO toques read_at aquí (lo fijamos en el UPDATE)
  }));

  const { error: upErr } = await sb
    .from("review_message_receipts")
    .upsert(upsertPayload, { onConflict: "message_id,user_id" });

  if (upErr) {
    return NextResponse.json(
      { error: upErr.message },
      { status: 500, headers: res.headers },
    );
  }

  // Paso 2: si hay que marcar READ, haz UPDATE explícito (requiere política UPDATE)
  if (body.mark === "read") {
    const { error: updErr } = await sb
      .from("review_message_receipts")
      .update({ read_at: now })
      .in("message_id", targetIds)
      .eq("user_id", user.id);

    if (updErr) {
      return NextResponse.json(
        { error: updErr.message },
        { status: 500, headers: res.headers },
      );
    }
  }

  return NextResponse.json(
    { ok: true, updated: targetIds.length },
    { headers: res.headers },
  );
}
