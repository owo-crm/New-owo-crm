import type { MetadataRoute } from "next";
import { appConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.productName,
    short_name: appConfig.productName,
    description: t("pwa.description"),
    lang: "pl",
    start_url: "/dzisiaj",
    scope: "/",
    display: "standalone",
    background_color: "#111315",
    theme_color: "#111315",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
