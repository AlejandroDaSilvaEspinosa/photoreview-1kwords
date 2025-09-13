// app/(protected)/page.tsx
import { getCachedSkus } from "@/lib/data";
import Home from "./home";
import { SkuWithImages } from '@/types/review';
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
  const username = user?.name || "user";

  const skus : SkuWithImages[] = await getCachedSkus(); // ✅ directamente desde servidor
  return <Home username={username} skus={skus} clientInfo={clientInfo} />;
}
 