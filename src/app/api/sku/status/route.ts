import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const { sku, status } = await req.json();
    if (!sku || !status) {
      return NextResponse.json(
        { error: "sku y status son obligatorios" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();
    const { error } = await sb.from("review_skus_status").upsert(
      {
        sku,
        status, // "validated" | "reopened" | ...
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sku" }
    );

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
