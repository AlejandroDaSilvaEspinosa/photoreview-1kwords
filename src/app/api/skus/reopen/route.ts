// POST /api/skus/reopen  body: { sku }

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: Request) {
  const { sku } = await req.json();
  if (!sku) return NextResponse.json({ error: "sku requerido" }, { status: 400 });
  const sb = supabaseAdmin();
  const { error } = await sb.rpc("reopen_sku", { p_sku: sku });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}