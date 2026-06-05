import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

// Production web server for Render. Serves the Vite build in dist/, falls
// back to index.html for client routes, and binds to Render's $PORT.
// Zero runtime dependencies — extend with /api or /ws routes later.

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = process.env.PORT || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

async function send(res, filePath, status = 200) {
  const body = await readFile(filePath);
  const immutable = filePath.includes(`${"assets"}`) && status === 200;
  res.writeHead(status, {
    "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
    "Cache-Control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const safe = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = join(DIST, safe);
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }
    if (info?.isFile()) return await send(res, filePath);
    // SPA fallback — unknown routes resolve to the app shell.
    return await send(res, join(DIST, "index.html"));
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mission Control serving dist/ on :${PORT}`);
});
