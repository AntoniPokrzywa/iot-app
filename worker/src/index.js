// VespaGuard API on Cloudflare Workers + D1. Same contract as backend/API.md.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const minutes = (value, fallback) => {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

const clean = (data, key) => (data[key] == null ? "" : String(data[key]).trim());
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const isUnique = (e) => /UNIQUE constraint failed/i.test(String(e?.message ?? e));

// ---- hive view -------------------------------------------------------------

const HIVE_SELECT = `
  SELECT h.id, h.name, h.lat, h.lng,
    (SELECT alert FROM events e WHERE e.hive_id = h.id ORDER BY ts DESC, id DESC LIMIT 1) AS ev_alert,
    (SELECT ts    FROM events e WHERE e.hive_id = h.id ORDER BY ts DESC, id DESC LIMIT 1) AS ev_ts,
    hl.ts AS hl_ts, hl.battery, hl.rssi
  FROM hives h LEFT JOIN health hl ON hl.hive_id = h.id`;

/**
 * alert     = latest event is an alert AND (if ALERT_TTL_MINUTES > 0) it is recent enough
 * last      = time of latest detection event
 * last_seen = latest sign of life (event or health ping); online = recent last_seen
 */
function hiveJson(row, env) {
  const now = Date.now();
  const ttl = minutes(env.ALERT_TTL_MINUTES, 5) * 60_000;
  const offlineAfter = minutes(env.OFFLINE_AFTER_MINUTES, 30) * 60_000;
  const seen = [row.ev_ts, row.hl_ts].filter(Boolean);
  const lastSeen = seen.length ? seen.reduce((a, b) => (a > b ? a : b)) : null; // same-format ISO strings sort chronologically
  const alert = row.ev_alert === 1 && (ttl === 0 || now - Date.parse(row.ev_ts) <= ttl);
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    alert,
    last: row.ev_ts ?? null,
    last_seen: lastSeen,
    online: lastSeen !== null && now - Date.parse(lastSeen) <= offlineAfter,
    battery: row.battery ?? null,
    rssi: row.rssi ?? null,
  };
}

async function getHive(env, id) {
  const row = await env.DB.prepare(`${HIVE_SELECT} WHERE h.id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, "Nie znaleziono ula");
  return hiveJson(row, env);
}

// ---- handlers --------------------------------------------------------------

async function listHives(env) {
  const { results } = await env.DB.prepare(`${HIVE_SELECT} ORDER BY h.rowid`).all();
  return json(results.map((r) => hiveJson(r, env)));
}

async function createHive(request, env) {
  const data = await readBody(request);
  const id = clean(data, "id");
  if (!id) throw new HttpError(400, "ID ula jest wymagane");
  try {
    await env.DB.prepare("INSERT INTO hives (id, name, lat, lng) VALUES (?, ?, ?, ?)")
      .bind(id, clean(data, "name"), clean(data, "lat"), clean(data, "lng"))
      .run();
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, "Ul o takim ID już istnieje");
    throw e;
  }
  return json(await getHive(env, id), 201);
}

async function updateHive(request, env, id) {
  await getHive(env, id);
  const data = await readBody(request);
  const newId = clean(data, "id") || id;
  try {
    // events/health follow a renamed id through ON UPDATE CASCADE.
    await env.DB.prepare("UPDATE hives SET id = ?, name = ?, lat = ?, lng = ? WHERE id = ?")
      .bind(newId, clean(data, "name"), clean(data, "lat"), clean(data, "lng"), id)
      .run();
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, "Ul o takim ID już istnieje");
    throw e;
  }
  return json(await getHive(env, newId));
}

async function deleteHive(env, id) {
  await getHive(env, id);
  await env.DB.prepare("DELETE FROM hives WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204, headers: CORS });
}

async function hiveLogs(env, id, url) {
  await getHive(env, id);
  const n = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.max(1, Math.min(Number.isFinite(n) ? n : 50, 500));
  const { results } = await env.DB.prepare(
    "SELECT alert, ts FROM events WHERE hive_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
  )
    .bind(id, limit)
    .all();
  return json(results.map((r) => ({ alert: r.alert === 1, ts: r.ts })));
}

async function addHealth(request, env, id) {
  await getHive(env, id);
  const data = await readBody(request);
  const values = {};
  for (const key of ["battery", "rssi"]) {
    const v = data[key];
    if (v != null && !isInt(v)) throw new HttpError(400, `Pole "${key}" musi być liczbą całkowitą`);
    values[key] = v ?? null;
  }
  if (values.battery !== null && (values.battery < 0 || values.battery > 100)) {
    throw new HttpError(400, 'Pole "battery" musi być w zakresie 0-100');
  }
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO health (hive_id, ts, battery, rssi) VALUES (?, ?, ?, ?)
     ON CONFLICT(hive_id) DO UPDATE SET ts = excluded.ts, battery = excluded.battery, rssi = excluded.rssi`,
  )
    .bind(id, ts, values.battery, values.rssi)
    .run();
  return json({ ts, ...values }, 201);
}

async function addEvent(request, env, id) {
  await getHive(env, id);
  const data = await readBody(request);
  if (typeof data.alert !== "boolean") throw new HttpError(400, 'Pole "alert" (boolean) jest wymagane');
  const ts = nowIso();
  await env.DB.prepare("INSERT INTO events (hive_id, alert, ts) VALUES (?, ?, ?)")
    .bind(id, data.alert ? 1 : 0, ts)
    .run();
  return json({ alert: data.alert, ts }, 201);
}

// ---- routing ---------------------------------------------------------------

async function route(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0 && method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ status: "ok" });
  }
  if (parts[0] === "api" && parts[1] === "hives") {
    const id = parts[2];
    const sub = parts[3];
    if (parts.length === 2) {
      if (method === "GET") return listHives(env);
      if (method === "POST") return createHive(request, env);
    } else if (parts.length === 3) {
      if (method === "GET") return json(await getHive(env, id));
      if (method === "PUT") return updateHive(request, env, id);
      if (method === "DELETE") return deleteHive(env, id);
    } else if (parts.length === 4) {
      if (sub === "logs" && method === "GET") return hiveLogs(env, id, url);
      if (sub === "health" && method === "POST") return addHealth(request, env, id);
      if (sub === "events" && method === "POST") return addEvent(request, env, id);
    }
  }
  throw new HttpError(404, "Nie znaleziono");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Błąd serwera" }, 500);
    }
  },
};
