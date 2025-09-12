import { NextResponse } from "next/server";
import { getImagesForSku, getReviewsBySku } from "@/lib/data";
import { cookies } from "next/headers";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { sku: string } }) {
  // protege con cookie
  const session = cookies().get("session");
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { sku } = params;
    const images = await getImagesForSku(sku);
    //change "name prop" to "filename"
    images?.forEach(img => {
      img.filename = img.name;
      img.url = `https://drive.google.com/uc?id=${img.id}`
      delete img.name;
    });
    
    return NextResponse.json( images );
  } catch (e: any) {
    console.error("GET /api/images/[sku] error:", e);
    return NextResponse.json({ error: "Failed to load images" }, { status: 500 });
  }
}
