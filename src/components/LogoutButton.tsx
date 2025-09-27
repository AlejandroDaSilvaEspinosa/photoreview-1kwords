"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const onClick = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  };
  return <button onClick={onClick}>Cerrar sesión</button>;
}
