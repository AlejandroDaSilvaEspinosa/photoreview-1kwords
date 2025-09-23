// app/(protected)/page.tsx
import { getCachedSkus } from "@/lib/dataSheets";
import { hydrateStatuses } from "@/lib/status";
import Home from "./home";
import type { SkuWithImages, SkuWithImagesAndStatus } from "@/types/review";
import { supabaseServer } from "@/lib/supabase/server";

export default async function HomePage() {
  const clientInfo = { name: "Castejon Joyeros", project: "Catalogo comercial joyeria" };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const username: string = (user?.user_metadata?.display_name as string) || user?.email || "user";

  const skus: SkuWithImages[] = await getCachedSkus();
  const skusWithStatus: SkuWithImagesAndStatus[] = await hydrateStatuses(skus);

  return <Home username={username} skus={skusWithStatus} clientInfo={clientInfo} />;
}
