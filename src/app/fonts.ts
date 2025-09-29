// app/fonts/power.ts
import localFont from "next/font/local";

export const powerCore = localFont({
  src: [
    {
      path: "./fonts/PowerGrotesk-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/PowerGrotesk-Italic.woff2",
      weight: "400",
      style: "italic",
    },
    { path: "./fonts/PowerGrotesk-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: true, // solo para lo crítico (above-the-fold)
  variable: "--font-power",
});

// Pesos “extra” solo donde hagan falta (y sin preload)
export const powerDisplay = localFont({
  src: [
    {
      path: "./fonts/PowerGrotesk-Black.woff2",
      weight: "900",
      style: "normal",
    },
    {
      path: "./fonts/PowerGrotesk-BlackItalic.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false, // que el navegador los pida bajo demanda
  variable: "--font-power-display",
});
