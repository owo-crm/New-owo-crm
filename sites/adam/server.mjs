// Minimalny serwer plików statycznych (bez zależności) dla Railway / dowolnego hostingu Node.
// Kanoniczny format adresów: z ukośnikiem na końcu („/uslugi/”). Brak ukośnika → 301.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".webp": "image/webp", ".svg": "image/svg+xml", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png" };
const security = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" };
const isFile = async (p) => (await stat(p).catch(() => null))?.isFile();

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path.includes("\0")) return res.writeHead(400).end();
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(dist, safe);
  if (!file.startsWith(dist)) return res.writeHead(400).end();
  if (!extname(safe) && !safe.endsWith("/") && (await isFile(join(file, "index.html"))))
    return res.writeHead(301, { Location: path + "/" + url.search, ...security }).end();
  if (safe.endsWith("/")) file = join(file, "index.html");
  let status = 200;
  if (!(await isFile(file))) { file = join(dist, "404.html"); status = 404; }
  const ext = extname(file);
  const cache = ext === ".html" || ext === ".xml" || ext === ".txt" ? "no-cache" : "public, max-age=604800";
  res.writeHead(status, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": cache, ...security });
  res.end(req.method === "HEAD" ? undefined : await readFile(file));
}).listen(Number(process.env.PORT) || 4300, () => console.log(`adam-site: http://localhost:${process.env.PORT || 4300}`));
