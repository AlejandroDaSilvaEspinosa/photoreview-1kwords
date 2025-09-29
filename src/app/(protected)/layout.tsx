// app/(protected)/layout.tsx
import type { Metadata } from "next";
import "../globals.css";
import { ToastProvider } from "@/hooks/useToast";
import Toaster from "@/components/Toaster";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { powerCore } from "@/app/fonts";

export const metadata: Metadata = {
  title: "1K Words - Revisión de Productos",
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
          {children}
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
