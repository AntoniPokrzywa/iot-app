import os
import sqlite3
from datetime import datetime, timedelta, timezone

from flask import Flask, abort, g, jsonify, request
from flask_cors import CORS

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "vespaguard.db"))
# A hive counts as offline when nothing (event or health ping) arrived for this long.
OFFLINE_AFTER = timedelta(minutes=int(os.environ.get("OFFLINE_AFTER_MINUTES", "30")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS hives (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    lat TEXT NOT NULL DEFAULT '',
    lng TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hive_id TEXT NOT NULL REFERENCES hives(id) ON DELETE CASCADE ON UPDATE CASCADE,
    alert INTEGER NOT NULL,
    ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_hive_ts ON events (hive_id, ts DESC);
CREATE TABLE IF NOT EXISTS health (
    hive_id TEXT PRIMARY KEY REFERENCES hives(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ts TEXT NOT NULL,
    battery INTEGER,
    rssi INTEGER
);
"""

app = Flask(__name__)
CORS(app)


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(SCHEMA)


init_db()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def hive_json(row):
    """Hive plus its latest status.

    `last` = latest detection event; `last_seen` = latest sign of life (event or
    health ping); `online` = last_seen is recent enough. All times are ISO UTC.
    """
    latest = db().execute(
        "SELECT alert, ts FROM events WHERE hive_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    health = db().execute("SELECT ts, battery, rssi FROM health WHERE hive_id = ?", (row["id"],)).fetchone()
    seen = [x["ts"] for x in (latest, health) if x]
    last_seen = max(seen) if seen else None  # ISO strings with the same format sort chronologically
    online = bool(last_seen) and datetime.now(timezone.utc) - parse_iso(last_seen) <= OFFLINE_AFTER
    return {
        "id": row["id"],
        "name": row["name"],
        "lat": row["lat"],
        "lng": row["lng"],
        "alert": bool(latest["alert"]) if latest else False,
        "last": latest["ts"] if latest else None,
        "last_seen": last_seen,
        "online": online,
        "battery": health["battery"] if health else None,
        "rssi": health["rssi"] if health else None,
    }


def get_hive_or_404(hive_id):
    row = db().execute("SELECT * FROM hives WHERE id = ?", (hive_id,)).fetchone()
    if row is None:
        abort(404, description="Nie znaleziono ula")
    return row


def clean(data, key):
    value = data.get(key, "")
    return str(value).strip() if value is not None else ""


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(409)
def http_error(e):
    return jsonify(error=e.description), e.code


@app.get("/")
def health():
    return jsonify(status="ok")


@app.get("/api/hives")
def list_hives():
    rows = db().execute("SELECT * FROM hives ORDER BY rowid").fetchall()
    return jsonify([hive_json(r) for r in rows])


@app.post("/api/hives")
def create_hive():
    data = request.get_json(silent=True) or {}
    hive_id = clean(data, "id")
    if not hive_id:
        abort(400, description="ID ula jest wymagane")
    if db().execute("SELECT 1 FROM hives WHERE id = ?", (hive_id,)).fetchone():
        abort(409, description="Ul o takim ID już istnieje")
    db().execute(
        "INSERT INTO hives (id, name, lat, lng) VALUES (?, ?, ?, ?)",
        (hive_id, clean(data, "name"), clean(data, "lat"), clean(data, "lng")),
    )
    db().commit()
    return jsonify(hive_json(get_hive_or_404(hive_id))), 201


@app.get("/api/hives/<hive_id>")
def get_hive(hive_id):
    return jsonify(hive_json(get_hive_or_404(hive_id)))


@app.put("/api/hives/<hive_id>")
def update_hive(hive_id):
    get_hive_or_404(hive_id)
    data = request.get_json(silent=True) or {}
    new_id = clean(data, "id") or hive_id
    if new_id != hive_id and db().execute("SELECT 1 FROM hives WHERE id = ?", (new_id,)).fetchone():
        abort(409, description="Ul o takim ID już istnieje")
    db().execute(
        "UPDATE hives SET id = ?, name = ?, lat = ?, lng = ? WHERE id = ?",
        (new_id, clean(data, "name"), clean(data, "lat"), clean(data, "lng"), hive_id),
    )
    db().commit()
    return jsonify(hive_json(get_hive_or_404(new_id)))


@app.delete("/api/hives/<hive_id>")
def delete_hive(hive_id):
    get_hive_or_404(hive_id)
    db().execute("DELETE FROM hives WHERE id = ?", (hive_id,))
    db().commit()
    return "", 204


@app.get("/api/hives/<hive_id>/logs")
def hive_logs(hive_id):
    get_hive_or_404(hive_id)
    limit = min(request.args.get("limit", default=50, type=int), 500)
    rows = db().execute(
        "SELECT alert, ts FROM events WHERE hive_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
        (hive_id, limit),
    ).fetchall()
    return jsonify([{"alert": bool(r["alert"]), "ts": r["ts"]} for r in rows])


@app.post("/api/hives/<hive_id>/health")
def add_health(hive_id):
    """Heartbeat from the IoT device. Body is optional: {"battery": 0-100, "rssi": dBm}."""
    get_hive_or_404(hive_id)
    data = request.get_json(silent=True) or {}
    values = {}
    for key in ("battery", "rssi"):
        v = data.get(key)
        if v is not None and (isinstance(v, bool) or not isinstance(v, int)):
            abort(400, description=f'Pole "{key}" musi być liczbą całkowitą')
        values[key] = v
    if values["battery"] is not None and not 0 <= values["battery"] <= 100:
        abort(400, description='Pole "battery" musi być w zakresie 0-100')
    ts = now_iso()
    db().execute(
        "INSERT INTO health (hive_id, ts, battery, rssi) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(hive_id) DO UPDATE SET ts = excluded.ts, battery = excluded.battery, rssi = excluded.rssi",
        (hive_id, ts, values["battery"], values["rssi"]),
    )
    db().commit()
    return jsonify(ts=ts, **values), 201


@app.post("/api/hives/<hive_id>/events")
def add_event(hive_id):
    """Called by the IoT device: {"alert": true|false}."""
    get_hive_or_404(hive_id)
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("alert"), bool):
        abort(400, description='Pole "alert" (boolean) jest wymagane')
    ts = now_iso()
    db().execute(
        "INSERT INTO events (hive_id, alert, ts) VALUES (?, ?, ?)",
        (hive_id, int(data["alert"]), ts),
    )
    db().commit()
    return jsonify(alert=data["alert"], ts=ts), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=os.environ.get("FLASK_DEBUG") == "1")
