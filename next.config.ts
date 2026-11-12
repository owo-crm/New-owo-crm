import type { NextConfig } from "next";

// output "standalone" = минимальная сборка для Docker-контейнера (Google Cloud Run);
// включается только при сборке Docker-образа (BUILD_STANDALONE=1), чтобы `npm start` работал локально.
// cacheComponents выключен: CRM почти полностью персональная (данные зависят от логина),
// классический динамический рендеринг проще и понятнее (решение 010 в docs/decisions.md).
const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Скрипт формы для сайтов клиентов (решение 034): короткий кэш, чтобы исправления доходили быстро.
        source: "/embed/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
