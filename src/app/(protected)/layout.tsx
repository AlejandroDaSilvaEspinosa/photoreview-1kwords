// Fichero: src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import '../globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '1K Words - Revisión de Productos',
  description: 'Panel de revisión de imágenes de productos para Castejón Joyeros',
};

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = cookies().get("session");
  if (!session) redirect("/login");
  return (
    <html lang="es">
      <body className={inter.className}>
        <>{children}</>
      </body>
    </html>
  );
}