import os
from datetime import timezone

import psycopg
from flask import Flask, abort, g, jsonify, request
from flask_cors import CORS
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set (Postgres connection string, e.g. from Neon)")

SCHEMA = """
CREATE TABLE IF NOT EXISTS hives (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    lat TEXT NOT NULL DEFAULT '',
    lng TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    hive_id TEXT NOT NULL REFERENCES hives(id) ON DELETE CASCADE ON UPDATE CASCADE,
    alert BOOLEAN NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_hive_ts ON events (hive_id, ts DESC);
"""

app = Flask(__name__)
CORS(app)


def db():
    if "db" not in g:
        g.db = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    with psycopg.connect(DATABASE_URL) as conn:
        # Several gunicorn workers may boot at once; serialise schema creation.
        conn.execute("SELECT pg_advisory_xact_lock(727401)")
        conn.execute(SCHEMA)


init_db()


def iso(ts):
    """TIMESTAMPTZ -> ISO-8601 UTC string, e.g. 2026-11-24T13:00:32Z."""
    if ts is None:
        return None
    return ts.astimezone(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z"


def hive_json(row):
    """Hive plus its latest status. `last` is an ISO timestamp (UTC) or None."""
    latest = db().execute(
        "SELECT alert, ts FROM events WHERE hive_id = %s ORDER BY ts DESC, id DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "lat": row["lat"],
        "lng": row["lng"],
        "alert": latest["alert"] if latest else False,
        "last": iso(latest["ts"]) if latest else None,
    }


def get_hive_or_404(hive_id):
    row = db().execute("SELECT * FROM hives WHERE id = %s", (hive_id,)).fetchone()
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
    db().execute("SELECT 1")
    return jsonify(status="ok")


@app.get("/api/hives")
def list_hives():
    rows = db().execute("SELECT * FROM hives ORDER BY id").fetchall()
    return jsonify([hive_json(r) for r in rows])


@app.post("/api/hives")
def create_hive():
    data = request.get_json(silent=True) or {}
    hive_id = clean(data, "id")
    if not hive_id:
        abort(400, description="ID ula jest wymagane")
    try:
        db().execute(
            "INSERT INTO hives (id, name, lat, lng) VALUES (%s, %s, %s, %s)",
            (hive_id, clean(data, "name"), clean(data, "lat"), clean(data, "lng")),
        )
        db().commit()
    except UniqueViolation:
        abort(409, description="Ul o takim ID już istnieje")
    return jsonify(hive_json(get_hive_or_404(hive_id))), 201


@app.get("/api/hives/<hive_id>")
def get_hive(hive_id):
    return jsonify(hive_json(get_hive_or_404(hive_id)))


@app.put("/api/hives/<hive_id>")
def update_hive(hive_id):
    get_hive_or_404(hive_id)
    data = request.get_json(silent=True) or {}
    new_id = clean(data, "id") or hive_id
    try:
        # events.hive_id follows a renamed id through ON UPDATE CASCADE.
        db().execute(
            "UPDATE hives SET id = %s, name = %s, lat = %s, lng = %s WHERE id = %s",
            (new_id, clean(data, "name"), clean(data, "lat"), clean(data, "lng"), hive_id),
        )
        db().commit()
    except UniqueViolation:
        abort(409, description="Ul o takim ID już istnieje")
    return jsonify(hive_json(get_hive_or_404(new_id)))


@app.delete("/api/hives/<hive_id>")
def delete_hive(hive_id):
    get_hive_or_404(hive_id)
    db().execute("DELETE FROM hives WHERE id = %s", (hive_id,))
    db().commit()
    return "", 204


@app.get("/api/hives/<hive_id>/logs")
def hive_logs(hive_id):
    get_hive_or_404(hive_id)
    limit = max(1, min(request.args.get("limit", default=50, type=int), 500))
    rows = db().execute(
        "SELECT alert, ts FROM events WHERE hive_id = %s ORDER BY ts DESC, id DESC LIMIT %s",
        (hive_id, limit),
    ).fetchall()
    return jsonify([{"alert": r["alert"], "ts": iso(r["ts"])} for r in rows])


@app.post("/api/hives/<hive_id>/events")
def add_event(hive_id):
    """Called by the IoT device: {"alert": true|false}."""
    get_hive_or_404(hive_id)
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("alert"), bool):
        abort(400, description='Pole "alert" (boolean) jest wymagane')
    row = db().execute(
        "INSERT INTO events (hive_id, alert) VALUES (%s, %s) RETURNING ts",
        (hive_id, data["alert"]),
    ).fetchone()
    db().commit()
    return jsonify(alert=data["alert"], ts=iso(row["ts"])), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=os.environ.get("FLASK_DEBUG") == "1")
