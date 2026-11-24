// Buduje statyczną stronę do dist/. Użycie: SITE_ENV=production SITE_URL=https://... CRM_URL=... INTAKE_KEY=... node build.mjs
import { mkdir, rm, writeFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { site, crm } from "./src/config.mjs";
import { pages, notFound, render } from "./src/pages.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(join(out, "assets"), { recursive: true });
await cp(join(root, "static"), out, { recursive: true });
await cp(join(root, "src/calc.mjs"), join(out, "assets/calc.mjs"));

const paths = new Set();
for (const p of [...pages, notFound]) {
  if (paths.has(p.path)) throw new Error(`Duplikat ścieżki: ${p.path}`);
  paths.add(p.path);
  const file = p.path.endsWith(".html") ? join(out, p.path) : join(out, p.path, "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, render(p));
}

const indexable = site.env === "production" ? pages.filter((p) => !p.noindex) : [];
await writeFile(join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable
    .map((p) => `  <url><loc>${site.url}${p.path}</loc></url>`).join("\n")}\n</urlset>\n`);
await writeFile(join(out, "robots.txt"), site.env === "production"
  ? `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`
  : "User-agent: *\nDisallow: /\n");

console.log(`Zbudowano ${pages.length} stron → dist/ (env: ${site.env}, url: ${site.url}, w sitemap: ${indexable.length})`);
if (!crm.url || !crm.intakeKey) console.warn("UWAGA: brak CRM_URL/INTAKE_KEY — formularz nie wysyła zgłoszeń.");
if (site.env === "production" && (!crm.url || !crm.intakeKey)) process.exitCode = 1;
