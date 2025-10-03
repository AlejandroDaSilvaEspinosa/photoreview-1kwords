import "../globals.css";
import { powerCore } from "@/app/fonts";

export const metadata = {
  title: "1kwords® - App",
  description:
    "Panel de revisión de imágenes de productos para Castejón Joyeros",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={powerCore.variable}>
      <body>{children}</body>
    </html>
  );
}
