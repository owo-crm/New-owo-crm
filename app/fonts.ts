import localFont from "next/font/local";

/**
 * Шрифты Barowo (Fontshare, бесплатная коммерческая лицензия ITF FFL), лежат в app/fonts.
 * Clash Display — заголовки и цифры, Satoshi — весь остальной текст.
 */
export const clash = localFont({
  src: [
    { path: "./fonts/ClashDisplay-Medium.woff2", weight: "500" },
    { path: "./fonts/ClashDisplay-Semibold.woff2", weight: "600" },
  ],
  variable: "--font-clash",
  display: "swap",
});

export const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-Regular.woff2", weight: "400" },
    { path: "./fonts/Satoshi-Medium.woff2", weight: "500" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "700" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

/**
 * Inter (SIL OFL) — шрифт интерфейса после редизайна (решение 024): один шрифт на всё,
 * переменный 100–900, с польскими буквами. Clash/Satoshi остаются только для документов Barowo.
 */
export const inter = localFont({
  src: [{ path: "./fonts/InterVariable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});
