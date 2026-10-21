import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env";

mkdirSync(env.dataDir, { recursive: true });

export const dbPath = process.env.DB_PATH ?? join(env.dataDir, "meshstream.db");
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    color TEXT NOT NULL,
    ip_hash TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS streams (
    id TEXT PRIMARY KEY,
    host_key_hash TEXT NOT NULL,
    guest_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'idle',
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    peak_viewers INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_streams_state ON streams(state, started_at DESC);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    guest_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    color TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_stream ON chat_messages(stream_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_s REAL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS view_sessions (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    guest_id TEXT,
    joined_at INTEGER NOT NULL,
    left_at INTEGER,
    peer_bytes INTEGER NOT NULL DEFAULT 0,
    origin_bytes INTEGER NOT NULL DEFAULT 0,
    rebuffers INTEGER NOT NULL DEFAULT 0,
    avg_latency REAL
  );

  CREATE TABLE IF NOT EXISTS telemetry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stream_id TEXT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

export interface GuestRow {
  id: string;
  display_name: string;
  color: string;
  ip_hash: string | null;
  created_at: number;
  last_seen: number;
}

export interface StreamRow {
  id: string;
  host_key_hash: string;
  guest_id: string;
  title: string;
  category: string;
  state: "idle" | "live" | "ended";
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  peak_viewers: number;
  display_name?: string;
  color?: string;
}

export function getGuest(id: string): GuestRow | undefined {
  return db.prepare("SELECT * FROM guests WHERE id = ?").get(id) as GuestRow | undefined;
}

export function touchGuest(id: string) {
  db.prepare("UPDATE guests SET last_seen = ? WHERE id = ?").run(Date.now(), id);
}

export function getStream(id: string): StreamRow | undefined {
  return db
    .prepare(
      `SELECT s.*, g.display_name, g.color
       FROM streams s LEFT JOIN guests g ON g.id = s.guest_id
       WHERE s.id = ?`,
    )
    .get(id) as StreamRow | undefined;
}

export function listLiveStreams(): StreamRow[] {
  return db
    .prepare(
      `SELECT s.*, g.display_name, g.color
       FROM streams s LEFT JOIN guests g ON g.id = s.guest_id
       WHERE s.state = 'live'
       ORDER BY s.started_at DESC
       LIMIT 24`,
    )
    .all() as unknown as StreamRow[];
}

export function insertChat(message: {
  id: string;
  streamId: string;
  guestId: string;
  displayName: string;
  color: string;
  body: string;
  createdAt: number;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO chat_messages
       (id, stream_id, guest_id, display_name, color, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.streamId,
    message.guestId,
    message.displayName,
    message.color,
    message.body,
    message.createdAt,
  );
}

export function getChatHistory(streamId: string, limit = 80) {
  const rows = db
    .prepare(
      `SELECT id, stream_id, guest_id, display_name, color, body, created_at
       FROM chat_messages WHERE stream_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(streamId, limit) as Array<{
    id: string;
    stream_id: string;
    guest_id: string;
    display_name: string;
    color: string;
    body: string;
    created_at: number;
  }>;
  return rows.reverse().map((row) => ({
    id: row.id,
    streamId: row.stream_id,
    guestId: row.guest_id,
    displayName: row.display_name,
    color: row.color,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export function insertTelemetry(streamId: string | null, kind: string, payload: unknown) {
  db.prepare(
    "INSERT INTO telemetry_events (stream_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
  ).run(streamId, kind, JSON.stringify(payload), Date.now());
}
