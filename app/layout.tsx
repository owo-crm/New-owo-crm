import type { Metadata, Viewport } from "next";
import "./globals.css";
import { clash, satoshi } from "./fonts";
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
  themeColor: "#111315",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${clash.variable} ${satoshi.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
