// Vercel serverless function: shared tracker state stored in Upstash Redis (free tier).
// Env vars (set automatically when you connect Upstash Redis in Vercel → Storage):
//   KV_REST_API_URL + KV_REST_API_TOKEN   or   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// Optional: EDIT_PIN — if set, changes need this PIN (viewing stays open to anyone with the link).

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PIN = process.env.EDIT_PIN || "";

const K_STATUS = "tracker:status";   // hash: roleId -> {status, note, updatedAt}
const K_CUSTOM = "tracker:custom";   // hash: roleId -> role object added from the page
const K_LOG = "tracker:log";         // list of activity entries, newest first

const STATUSES = ["todo", "writing", "applied", "test", "interview", "offer", "rejected", "skip"];

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function hashToObj(arr) {
  const out = {};
  if (Array.isArray(arr)) {
    for (let i = 0; i < arr.length; i += 2) {
      try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch { /* skip bad entry */ }
    }
  } else if (arr && typeof arr === "object") {
    for (const [k, v] of Object.entries(arr)) { try { out[k] = JSON.parse(v); } catch {} }
  }
  return out;
}

const clean = (s, n) => String(s ?? "").slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) {
    return res.status(503).json({ error: "Storage not connected. Add Upstash Redis in Vercel → Storage, then redeploy." });
  }
  try {
    if (req.method === "GET") {
      const [status, custom, log] = await Promise.all([
        redis(["HGETALL", K_STATUS]),
        redis(["HGETALL", K_CUSTOM]),
        redis(["LRANGE", K_LOG, "0", "99"]),
      ]);
      return res.status(200).json({
        status: hashToObj(status),
        custom: hashToObj(custom),
        log: (log || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean),
        pinRequired: !!PIN,
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (PIN && body.pin !== PIN) return res.status(401).json({ error: "Wrong PIN" });
      const now = new Date().toISOString();
      const who = clean(body.who, 30) || "Someone";

      if (body.action === "status") {
        const id = clean(body.id, 80);
        const status = STATUSES.includes(body.status) ? body.status : "todo";
        const note = clean(body.note, 500);
        const label = clean(body.label, 140);
        const prevRaw = await redis(["HGET", K_STATUS, id]);
        const prev = prevRaw ? JSON.parse(prevRaw) : { status: "todo" };
        await redis(["HSET", K_STATUS, id, JSON.stringify({ status, note, updatedAt: now })]);
        if (prev.status !== status || (prev.note || "") !== note) {
          await redis(["LPUSH", K_LOG, JSON.stringify({ t: now, id, label, from: prev.status, to: status, note: prev.status === status ? note : "", who })]);
          await redis(["LTRIM", K_LOG, "0", "199"]);
        }
        return res.status(200).json({ ok: true });
      }

      if (body.action === "add") {
        const r = body.role || {};
        const id = "c-" + Date.now().toString(36);
        const role = {
          id, custom: true,
          co: clean(r.co, 80), role: clean(r.role, 140), sector: clean(r.sector, 60) || "Added",
          def: !!r.def, loc: clean(r.loc, 80), start: clean(r.start, 40), pay: clean(r.pay, 40),
          due: /^\d{4}-\d{2}-\d{2}$/.test(r.due || "") ? r.due : "rolling",
          vet: "", why: clean(r.why, 300), url: /^https?:\/\//.test(r.url || "") ? clean(r.url, 500) : "",
        };
        if (!role.co || !role.role) return res.status(400).json({ error: "Company and role are required" });
        await redis(["HSET", K_CUSTOM, id, JSON.stringify(role)]);
        await redis(["LPUSH", K_LOG, JSON.stringify({ t: now, id, label: `${role.co}: ${role.role}`, added: true, who })]);
        return res.status(200).json({ ok: true, id });
      }

      if (body.action === "remove") {
        const id = clean(body.id, 80);
        if (!id.startsWith("c-")) return res.status(400).json({ error: "Only roles added from the page can be removed" });
        await redis(["HDEL", K_CUSTOM, id]);
        await redis(["HDEL", K_STATUS, id]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
