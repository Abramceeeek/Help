// Shared tracker state stored in Redis.
// Works with whichever Redis Vercel's Storage tab gives you:
//   • Upstash (REST):  KV_REST_API_URL + KV_REST_API_TOKEN, UPSTASH_REDIS_REST_URL + _TOKEN,
//                      or the same names with any custom prefix (e.g. STORAGE_KV_REST_API_URL)
//   • Redis / Redis Cloud (TCP): REDIS_URL (or any *_REDIS_URL / KV_URL starting with redis:// or rediss://)
// Optional: EDIT_PIN — if set, changes need this PIN (viewing stays open to anyone with the link).

const PIN = process.env.EDIT_PIN || "";
const K_STATUS = "tracker:status";
const K_CUSTOM = "tracker:custom";
const K_LOG = "tracker:log";
const STATUSES = ["todo", "writing", "applied", "test", "interview", "offer", "rejected", "skip"];

// ---------- find the connection settings, whatever they're called ----------
function findRest() {
  const env = process.env;
  const keys = Object.keys(env);
  for (const k of keys) {
    let base = null;
    if (k.endsWith("REST_API_URL")) base = k.slice(0, -"REST_API_URL".length);       // ..._KV_REST_API_URL
    else if (k.endsWith("REDIS_REST_URL")) base = k.slice(0, -"REDIS_REST_URL".length); // ..._UPSTASH_REDIS_REST_URL
    if (base === null || !/^https?:\/\//.test(env[k] || "")) continue;
    const tokenKey = k.endsWith("REST_API_URL") ? base + "REST_API_TOKEN" : base + "REDIS_REST_TOKEN";
    if (env[tokenKey]) return { url: env[k], token: env[tokenKey] };
  }
  return null;
}
function findTcp() {
  const env = process.env;
  const prefer = ["REDIS_URL", "KV_URL"];
  for (const k of [...prefer, ...Object.keys(env).filter((k) => /(REDIS_URL|KV_URL)$/.test(k))]) {
    if (/^rediss?:\/\//.test(env[k] || "")) return env[k];
  }
  return null;
}
function storageVarNames() {
  return Object.keys(process.env).filter((k) => /REDIS|KV|UPSTASH/i.test(k)).sort();
}

// ---------- one tiny "run a Redis command" function for both kinds ----------
let tcpClient = globalThis.__trackerRedis || null;
async function getRunner() {
  const rest = findRest();
  if (rest) {
    return async (cmd) => {
      const r = await fetch(rest.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${rest.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(cmd),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      return j.result;
    };
  }
  const tcpUrl = findTcp();
  if (tcpUrl) {
    if (!tcpClient) {
      const { createClient } = await import("redis");
      tcpClient = createClient({ url: tcpUrl, socket: { connectTimeout: 8000 } });
      tcpClient.on("error", () => {});
      await tcpClient.connect();
      globalThis.__trackerRedis = tcpClient;
    }
    return (cmd) => tcpClient.sendCommand(cmd.map(String));
  }
  return null;
}

function hashToObj(arr) {
  const out = {};
  const put = (k, v) => { try { out[k] = JSON.parse(v); } catch { /* skip bad entry */ } };
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) put(arr[i], arr[i + 1]);
  else if (arr && typeof arr === "object") for (const [k, v] of Object.entries(arr)) put(k, v);
  return out;
}
const clean = (s, n) => String(s ?? "").slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  let redis;
  try {
    redis = await getRunner();
  } catch (e) {
    return res.status(503).json({ error: "Found Redis settings but couldn't connect: " + (e.message || e) });
  }
  if (!redis) {
    const seen = storageVarNames();
    return res.status(503).json({
      error: seen.length
        ? `Storage settings found (${seen.join(", ")}) but none usable. Check the database is connected to Production, then redeploy.`
        : "No storage settings found. Connect the database to this project (Production ticked), then Redeploy.",
      seenVariableNames: seen,
    });
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
