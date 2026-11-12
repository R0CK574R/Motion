// Serves the built frontend the way Vercel will, so tests run against the
// production setup: the rewrites and headers come from frontend/vercel.json,
// including the security policy, and /api/* is forwarded to a local API.
//
//   API_ORIGIN=http://localhost:4000 PORT=5173 node e2e/serve-like-vercel.mjs
//
// It understands only the patterns vercel.json uses here (":path*" and
// plain regular expressions). It is a test fixture, not a production server.
import { createServer, request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "..", "frontend", "dist");
const config = JSON.parse(await readFile(join(here, "..", "frontend", "vercel.json"), "utf8"));
const API_ORIGIN = new URL(process.env.API_ORIGIN || "http://localhost:4000");
const PORT = Number(process.env.PORT || 5173);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json",
};

const toRegex = (source) => new RegExp(`^${source.replace(/:path\*/g, "(.*)")}$`);
const rewrites = config.rewrites.map((r) => ({ ...r, re: toRegex(r.source) }));
const headerRules = config.headers.map((h) => ({ ...h, re: toRegex(h.source) }));

function applyHeaders(path, res) {
  for (const rule of headerRules) {
    if (rule.re.test(path)) {
      for (const { key, value } of rule.headers) res.setHeader(key, value);
    }
  }
}

async function sendFile(path, res) {
  const file = normalize(join(dist, path));
  if (!file.startsWith(dist)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
  res.end(await readFile(file));
  return true;
}

function proxy(req, res) {
  // Like Vercel, tell the API who the visitor is and what host they asked for.
  const headers = {
    ...req.headers,
    host: API_ORIGIN.host,
    "x-forwarded-host": req.headers.host,
    "x-forwarded-proto": "http",
    "x-forwarded-for": req.socket.remoteAddress,
  };
  const upstream = request(
    { hostname: API_ORIGIN.hostname, port: API_ORIGIN.port, path: req.url, method: req.method, headers },
    (answer) => {
      for (const [key, value] of Object.entries(answer.headers)) {
        if (!res.hasHeader(key)) res.setHeader(key, value);
      }
      res.writeHead(answer.statusCode);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Upstream unavailable");
  });
  req.pipe(upstream);
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  applyHeaders(path, res);
  // Vercel serves an existing file before applying rewrites.
  if (path !== "/" && (await sendFile(path, res))) return;
  const rewrite = rewrites.find((r) => r.re.test(path));
  if (rewrite && /^https?:/.test(rewrite.destination)) return proxy(req, res);
  if (rewrite && (await sendFile(rewrite.destination, res))) return;
  res.writeHead(404).end("Not found");
}).listen(PORT, () => console.log(`Serving frontend/dist like Vercel on http://localhost:${PORT}`));
