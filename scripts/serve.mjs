#!/usr/bin/env node
/**
 * serve.mjs — zero-dependency static server for the TCG ticker repo.
 * Serves the repo root so src/ticker.html can fetch ../data/cards.json.
 * "/" redirects to the ticker. Used for local preview AND by capture.mjs.
 *
 * Usage: node scripts/serve.mjs            (PORT env or 4173)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, normalize, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2":"font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/" || urlPath === "") urlPath = "/src/ticker.html";

    // contain inside ROOT (no path traversal)
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" }).end("404 Not Found");
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    }).end(body);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" }).end("500 " + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`TCG ticker → http://localhost:${PORT}/  (root: ${ROOT})`);
});
