import { NextResponse } from "next/server";
import { getAllSkus } from "@/lib/data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const skus = await getAllSkus();
    return NextResponse.json(skus);
  } catch (e: any) {
    console.error("Error /api/skus:", e);
    return NextResponse.json({ error: "Failed to fetch skus" }, { status: 500 });
  }
}
