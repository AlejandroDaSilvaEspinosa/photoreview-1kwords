// app/(protected)/page.tsx
import { getCachedSkus } from "@/lib/dataSheets";
import { hydrateStatuses } from "@/lib/status";

import Home from "./home";
import { SkuWithImages,SkuWithImagesAndStatus } from '@/types/review';
import { cookies } from "next/headers";
import { verifyToken,SESSION_COOKIE_NAME } from "@/lib/auth";


export default async function HomePage() {
  const clientInfo = {
    name: "Castejon Joyeros",
    project: "Catalogo comercial joyeria",
  };
    // Usuario desde tu cookie JWT
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  const username:string|null = user?.name || "user";

  const skus : SkuWithImages[] = await getCachedSkus(); // ✅ directamente desde servidor
  const skusWithStatus : SkuWithImagesAndStatus[] = await hydrateStatuses(skus); // <- aquí
  
  return <Home username={username} skus={skusWithStatus} clientInfo={clientInfo} />;
}
 