import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { safePath } from "../companion/core.mjs";

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
export function assetHandler(host, root, { example = false } = {}) {
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== host || request.method !== "GET") return new Response(null, { status: 403 });
      const pathname = decodeURIComponent(url.pathname);
      const file = example ? (pathname === "/index.html" ? "desktop-demo.html" : "") : pathname.replace(/^\//, "");
      if (!file || file.includes("\0")) return new Response(null, { status: 404 });
      const data = await readFile(safePath(root, file));
      return new Response(data, { headers: {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Content-Security-Policy": example
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
          : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch { return new Response(null, { status: 404 }); }
  };
}
