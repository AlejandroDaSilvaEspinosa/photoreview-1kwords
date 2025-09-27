import { NextResponse } from "next/server";
import { getCachedSkus } from "@/lib/dataSheets";
import { cookies } from "next/headers";
export const runtime = "nodejs";

export async function GET() {
  // protege con cookie
  const session = cookies().then((c) => c.get("session"));
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const skus = await getCachedSkus();
    return NextResponse.json(skus);
  } catch (e: any) {
    console.error("Error /api/skus:", e);
    return NextResponse.json(
      { error: "Failed to fetch skus" },
      { status: 500 },
    );
  }
}
