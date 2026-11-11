import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { inter } from "./fonts";
import { t } from "@/lib/i18n";
import { appConfig } from "@/lib/config";

export const metadata: Metadata = {
  title: { default: appConfig.productName, template: `%s · ${appConfig.productName}` },
  description: t("pwa.description"),
  appleWebApp: { capable: true, title: appConfig.productName, statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/icon-192.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e10" },
  ],
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Тема: cookie owo_theme = light | dark; без cookie — как в системе.
  const stored = (await cookies()).get("owo_theme")?.value;
  const theme = stored === "light" || stored === "dark" ? stored : undefined;
  return (
    <html lang="pl" data-theme={theme} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
