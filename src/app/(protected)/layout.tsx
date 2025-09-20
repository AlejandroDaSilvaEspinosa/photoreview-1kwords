// Fichero: src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

import '../globals.css';
import { ToastProvider } from "@/hooks/useToast";
import Toaster from "@/components/Toaster";

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '1K Words - Revisión de Productos',
  description: 'Panel de revisión de imágenes de productos para Castejón Joyeros',
};

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    redirect("/login");
  }
  return (
    <html lang="es">
      <body className={inter.className}>
        <ToastProvider>
          {children}
          <Toaster/>
        </ToastProvider>
      </body>
    </html>
  );
}