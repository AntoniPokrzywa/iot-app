# VespaGuard backend API — for hive nodes

Runs on Cloudflare Workers + D1 (always on, data is persistent).

Hive nodes (IoT devices) report to this backend over plain HTTPS + JSON.

- **Base URL:** `https://vespaguard-api.vespa-guard.workers.dev`
- **Auth:** none (yet). Do not hardcode anything secret; there is nothing to send.
- **Content type:** send `Content-Type: application/json` on every request with a body.
- **Timestamps:** the server sets them (UTC). Nodes must NOT send timestamps and need no clock.
- **Hive ID:** a short unique string, e.g. `VG-0157` (printed on the device sticker). Use it in URL paths (URL-encode if it contains special characters).

## What a node must do

| What | When | Endpoint |
|---|---|---|
| Register itself | once at first boot (and again on `404`, see below) | `POST /api/hives` |
| Health check (heartbeat) | every **5–10 minutes**, always | `POST /api/hives/{id}/health` |
| Report a detection | **immediately** when a hornet is detected | `POST /api/hives/{id}/events` with `{"alert": true}` |
| Report all-clear | optional, e.g. when a detection ends | `POST /api/hives/{id}/events` with `{"alert": false}` |

The app marks a hive **offline** if nothing (heartbeat or event) arrived for 30 minutes, so the heartbeat interval must be well under that.
Heartbeats do NOT appear in the detection log; events do.

## Endpoints

### 1. Register a hive — `POST /api/hives`

`id` is required; `name`, `lat`, `lng` are optional strings.

```bash
curl -X POST https://vespaguard-api.vespa-guard.workers.dev/api/hives \
  -H "Content-Type: application/json" \
  -d '{"id":"VG-0157","name":"Ul na łące","lat":"50.0647","lng":"19.9450"}'
```

- `201` → `{"id":"VG-0157","name":"Ul na łące","lat":"50.0647","lng":"19.9450","alert":false,"last":null,"last_seen":null,"online":false,"battery":null,"rssi":null}`
- `409` `{"error":"Ul o takim ID już istnieje"}` → already registered. **Treat as success.**
- `400` `{"error":"ID ula jest wymagane"}` → `id` missing/empty.

### 2. Health check (heartbeat) — `POST /api/hives/{id}/health`

Body is optional. `battery` = integer 0–100 (%), `rssi` = integer dBm (e.g. `-71`). Send the latest values each time; omitted fields are stored as null.

```bash
# minimal: "I'm alive"
curl -X POST https://vespaguard-api.vespa-guard.workers.dev/api/hives/VG-0157/health

# with battery and signal strength
curl -X POST https://vespaguard-api.vespa-guard.workers.dev/api/hives/VG-0157/health \
  -H "Content-Type: application/json" \
  -d '{"battery":87,"rssi":-71}'
```

- `201` → `{"ts":"2026-11-24T13:35:21Z","battery":87,"rssi":-71}`
- `404` `{"error":"Nie znaleziono ula"}` → hive not registered (see "Resets" below).
- `400` → `battery`/`rssi` not an integer, or `battery` outside 0–100.

### 3. Detection event — `POST /api/hives/{id}/events`

`alert` is **required** and must be a real JSON boolean (`true`/`false`, not `"true"` or `1`).

```bash
# hornet detected
curl -X POST https://vespaguard-api.vespa-guard.workers.dev/api/hives/VG-0157/events \
  -H "Content-Type: application/json" \
  -d '{"alert":true}'

# all clear
curl -X POST https://vespaguard-api.vespa-guard.workers.dev/api/hives/VG-0157/events \
  -H "Content-Type: application/json" \
  -d '{"alert":false}'
```

- `201` → `{"alert":true,"ts":"2026-11-24T13:32:02Z"}`
- `404` → hive not registered. `400` → `alert` missing or not a boolean.

The hive's status in the app is its **latest** event (`true` = red "Wykryto szerszenia", `false` = green "Ul bezpieczny").
**An alert turns off by itself 5 minutes after the last `alert:true`.** While a hornet is present, keep re-sending `alert:true` (e.g. every 15–60 s) to keep the alarm on. Sending `alert:false` clears it immediately. Heartbeats never change the alert status.

### 4. Read back (for testing/debugging)

```bash
curl https://vespaguard-api.vespa-guard.workers.dev/api/hives                 # all hives + status
curl https://vespaguard-api.vespa-guard.workers.dev/api/hives/VG-0157         # one hive
curl "https://vespaguard-api.vespa-guard.workers.dev/api/hives/VG-0157/logs?limit=20"   # newest first
curl https://vespaguard-api.vespa-guard.workers.dev/                          # backend health: {"status":"ok"}
```

Hive fields: `alert` (latest event), `last` (time of latest event), `last_seen` (latest event OR heartbeat), `online` (last_seen within 30 min), `battery`, `rssi`, `heartbeat_interval` (seconds between expected health pings, currently 300).
The app shows a countdown circle per hive: full and green right after a health ping, draining and turning orange then red until the next expected one (`last_seen` + `heartbeat_interval`). **Send health pings at that interval (every 5 min) so the circle refills on time.**

## Errors

All errors are JSON: `{"error":"<message in Polish>"}`. Success is always `2xx` (`201` for the POSTs above).

| Status | Meaning | Node should |
|---|---|---|
| `201` | stored | done |
| `400` | bad body (see message) | fix the payload; do not retry unchanged |
| `404` | hive ID not registered | re-register (`POST /api/hives`), then retry once |
| `409` | hive already exists (registration only) | treat as success |
| `5xx` / timeout / no connection | server down or waking up | retry with backoff |

## Reliability rules (important)

1. **No cold starts:** the API is always on and answers in well under a second. A request timeout of 10–30 s is plenty.
2. **Retry with backoff** on timeouts / `5xx` / network errors (e.g. 5 s, 15 s, 60 s). **Alert events (`alert:true`) are the priority:** queue and retry until `201`.
3. **Data is persistent** (Cloudflare D1). Still, if any call returns `404`, re-register (`POST /api/hives`, same id/name/lat/lng) and retry the original request. Registration is idempotent (`409` = fine).
4. Use HTTPS with a normal root CA bundle.
5. Don't send timestamps. While a hornet is present, repeat `alert:true` every 15–60 s (the alarm expires 5 min after the last one); don't send one per sensor sample.

## Suggested node loop (pseudocode)

```text
boot:
    POST /api/hives {id, name, lat, lng}            # 201 or 409 = ok

every 5-10 min:
    POST /api/hives/{id}/health {battery, rssi}     # on 404 -> register, retry

on hornet detected:
    POST /api/hives/{id}/events {"alert": true}     # retry until 201

on detection ended:
    POST /api/hives/{id}/events {"alert": false}
```

## Quick smoke test (copy/paste)

```bash
B=https://vespaguard-api.vespa-guard.workers.dev; H='Content-Type: application/json'
curl -m 90 -X POST $B/api/hives -H "$H" -d '{"id":"SMOKE-1","name":"smoke test"}'
curl -m 90 -X POST $B/api/hives/SMOKE-1/health -H "$H" -d '{"battery":90,"rssi":-65}'
curl -m 90 -X POST $B/api/hives/SMOKE-1/events -H "$H" -d '{"alert":true}'
curl -m 90 $B/api/hives/SMOKE-1
curl -m 90 -X DELETE $B/api/hives/SMOKE-1      # cleanup, returns 204
```
