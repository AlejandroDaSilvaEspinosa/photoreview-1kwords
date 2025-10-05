// app/(protected)/layout.tsx
import type { Metadata } from "next";
import "../globals.css";
import { ToastProvider } from "@/hooks/useToast";
import Toaster from "@/components/Toaster";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { powerCore } from "@/app/fonts";
import { DotNumbersProvider } from "@/contexts/DotNumbersProvider";

export const metadata: Metadata = {
  title: "1kwords® - App",
  description:
    "Panel de revisión de imágenes de productos para Castejón Joyeros",
};

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <html lang="es" className={powerCore.variable}>
      <body>
        <ToastProvider>
          <DotNumbersProvider>{children}</DotNumbersProvider>
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
