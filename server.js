// For Render (or any Node host). Vercel ignores this file and uses /api + /public directly.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "./api/state.js";

const PORT = process.env.PORT || 3000;
const page = path.join(path.dirname(new URL(import.meta.url).pathname), "public", "index.html");

http.createServer((req, res) => {
  if (req.url.startsWith("/api/state")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
      const shim = {
        code: 200,
        setHeader: (k, v) => res.setHeader(k, v),
        status(c) { this.code = c; return this; },
        json(o) { res.statusCode = this.code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); },
      };
      handler(req, shim);
    });
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(page).pipe(res);
}).listen(PORT, () => console.log("Tracker running on port " + PORT));
