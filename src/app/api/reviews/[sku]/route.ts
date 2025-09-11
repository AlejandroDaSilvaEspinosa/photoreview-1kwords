import { NextResponse } from "next/server";
import { getImagesForSku, getReviewsBySku } from "@/lib/data";
import { transform } from "next/dist/build/swc";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { sku: string } }) {
  try {
    const { sku } = params;
    const reviews = await getReviewsBySku(sku);
    console.log(reviews)
    return NextResponse.json(reviews);
  } catch (e: any) {
    console.error("GET /api/reviews/[sku] error:", e);
    return NextResponse.json({ error: "Failed to load images" }, { status: 500 });
  }
}
