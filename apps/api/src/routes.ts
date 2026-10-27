import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  db,
  getChatHistory,
  getStream,
  insertChat,
  insertTelemetry,
  listLiveStreams,
  type StreamRow,
} from "./db";
import { env } from "./env";
import {
  chargeRate,
  ensureGuest,
  peekRate,
  rateLimit,
  refreshGuestCookie,
} from "./guest";
import {
  ByteMeter,
  getHashes,
  getOriginMbps,
  getTotalOriginMbps,
  mintPlaybackToken,
  verifyPlaybackToken,
} from "./hls";
import { startMediaSessionPoller, type MediaSessionPoller } from "./mediamtx";

const GUEST_COLORS = new Set([
  "#C9F73A",
  "#5B9DFF",
  "#C084FC",
  "#FFB020",
  "#FF8A8E",
  "#3DDC97",
  "#67E8F9",
  "#F0ABFC",
]);

const CATEGORIES = new Set([
  "Just Chatting",
  "Technology",
  "Gaming",
  "Music",
  "Creative",
  "Education",
  "Sports",
  "Other",
]);

interface SignalStats {
  viewers: number;
  peers: number;
  edges: number;
  maxDepth: number;
}

// Phase 4: direct WebRTC (WHEP) playback sessions. MediaMTX's WebRTC read
// endpoint is loopback-only, so the API is the only public entrypoint; every
// session here is token-gated at creation, capped per stream and accounted
// per session. The authoritative per-session byte count comes from the
// MediaMTX control API on loopback; the viewer's getStats() report stays
// advisory. Sessions that stop heartbeating expire below.
interface WhepSession {
  id: string;
  streamId: string;
  guestId: string;
  createdAt: number;
  lastSeen: number;
  reportedMbps: number;
  /** The WHEP session token MediaMTX answers with (DELETE credential). */
  deleteToken: string;
  /** MediaMTX control-API cumulative bytes sent to this viewer. */
  meterBytes: number;
  /** Rolling Mbps computed from real MediaMTX deltas; null before first poll. */
  meter: ByteMeter;
  /** Seen at least once by the control API poller. */
  meterObserved: boolean;
  meterAt: number;
}

const WHEP_SESSION_TTL_MS = 90 * 1000;
/** WHEP creation rate budget: successful creations only see this window. */
const WHEP_RATE_MAX = 6;
const WHEP_RATE_WINDOW_MS = 60 * 1000;
const whepSessions = new Map<string, WhepSession>();

function countWhepSessions(streamId: string) {
  const cutoff = Date.now() - WHEP_SESSION_TTL_MS;
  for (const [id, session] of whepSessions) {
    if (session.lastSeen < cutoff) whepSessions.delete(id);
  }
  let count = 0;
  for (const session of whepSessions.values()) {
    if (session.streamId === streamId) count += 1;
  }
  return count;
}

/**
 * Real origin egress from all accounted WHEP sessions (control-API deltas).
 * Unobserved sessions contribute their advisory report until the poller
 * catches up so the budget guard is never blind to a live viewer.
 */
function totalWhepMbps() {
  const cutoff = Date.now() - WHEP_SESSION_TTL_MS;
  let total = 0;
  for (const session of whepSessions.values()) {
    if (session.lastSeen < cutoff) continue;
    total += session.meterObserved && session.meterAt > 0 ? session.meter.mbps() : session.reportedMbps;
  }
  return total;
}

function whepMbpsForStream(streamId: string) {
  const cutoff = Date.now() - WHEP_SESSION_TTL_MS;
  let total = 0;
  for (const session of whepSessions.values()) {
    if (session.streamId !== streamId || session.lastSeen < cutoff) continue;
    total += session.meterObserved && session.meterAt > 0 ? session.meter.mbps() : session.reportedMbps;
  }
  return total;
}

/**
 * Control-API poller: folds whatever MediaMTX currently knows about every
 * WebRTC reader session back into the local session table. MediaMTX session
 * ids are the same string the route tables key sessions by.
 */
const mediaPoller: MediaSessionPoller = startMediaSessionPoller((sid, sent) => {
  const session = whepSessions.get(sid);
  if (!session) return;
  if (session.meterObserved && sent >= session.meterBytes) {
    session.meter.add(sent - session.meterBytes);
  }
  session.meterBytes = sent;
  session.meterObserved = true;
  session.meterAt = Date.now();
});

async function fetchSignalStats(streamId: string): Promise<SignalStats> {
  try {
    const response = await fetch(
      `${env.signalStatsUrl}/stats?stream=${encodeURIComponent(streamId)}`,
      { signal: AbortSignal.timeout(900) },
    );
    if (!response.ok) throw new Error("signal stats failed");
    const data = (await response.json()) as Partial<SignalStats>;
    return {
      viewers: Number(data.viewers ?? 0),
      peers: Number(data.peers ?? 0),
      edges: Number(data.edges ?? 0),
      maxDepth: Number(data.maxDepth ?? 0),
    };
  } catch {
    return { viewers: 0, peers: 0, edges: 0, maxDepth: 0 };
  }
}

function hostKeyHash(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function requireHost(
  request: FastifyRequest,
  reply: FastifyReply,
  streamId: string,
): StreamRow | null {
  const stream = getStream(streamId);
  if (!stream) {
    reply.code(404).send({ error: "stream not found" });
    return null;
  }
  const raw = request.headers["x-host-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || hostKeyHash(key) !== stream.host_key_hash) {
    reply.code(401).send({ error: "host key required" });
    return null;
  }
  return stream;
}

function toSummary(row: StreamRow, stats?: SignalStats) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    state: row.state,
    hostName: row.display_name ?? "Guest",
    hostColor: row.color ?? "#C9F73A",
    startedAt: row.started_at,
    endedAt: row.ended_at,
    viewerCount: stats?.viewers ?? 0,
    peerCount: stats?.peers ?? 0,
  };
}

function computeHealth(
  state: string,
  originMbps: number,
  budget: number,
  stats: SignalStats,
  directMbps = 0,
) {
  if (state !== "live") return "F" as const;
  // The origin uplink is shared by the HLS proxy and the direct WebRTC
  // sessions, so both count against the budget.
  const usedMbps = originMbps + directMbps;
  let score = 100;
  if (usedMbps > budget) score -= 40;
  else if (usedMbps > budget * 0.85) score -= 22;
  else if (usedMbps > budget * 0.65) score -= 8;
  if (stats.viewers > 2 && stats.peers === 0) score -= 10;
  if (score >= 90) return "A" as const;
  if (score >= 75) return "B" as const;
  if (score >= 60) return "C" as const;
  if (score >= 40) return "D" as const;
  return "F" as const;
}

function walkRecordings(dir: string): Array<{ name: string; size: number; modifiedAt: number }> {
  if (!existsSync(dir)) return [];
  const files: Array<{ name: string; size: number; modifiedAt: number }> = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(mp4|m4s|ts|webm)$/i.test(entry.name)) {
        const stat = statSync(full);
        files.push({
          name: relative(dir, full).replaceAll("\\", "/"),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      }
    }
  };
  walk(dir);
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 100);
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({
    ok: true,
    service: "meshstream-api",
    time: Date.now(),
  }));

  app.get("/api/media/health", async () => {
    try {
      await fetch(`${env.mediaHlsOrigin}/live/__meshstream_probe__/index.m3u8`, {
        signal: AbortSignal.timeout(900),
      });
      return { reachable: true };
    } catch {
      return { reachable: false };
    }
  });

  app.get("/api/guest", async (request, reply) => {
    const guest = ensureGuest(request, reply);
    reply.header("cache-control", "no-store");
    return {
      id: guest.id,
      displayName: guest.display_name,
      color: guest.color,
      createdAt: guest.created_at,
    };
  });

  app.patch("/api/guest", async (request, reply) => {
    const guest = ensureGuest(request, reply);
    const body = (request.body ?? {}) as { displayName?: unknown; color?: unknown };
    if (typeof body.displayName === "string") {
      const name = body.displayName.trim().slice(0, 24);
      if (name.length < 2) return reply.code(400).send({ error: "name is too short" });
      db.prepare("UPDATE guests SET display_name = ? WHERE id = ?").run(name, guest.id);
    }
    if (typeof body.color === "string") {
      if (!GUEST_COLORS.has(body.color)) {
        return reply.code(400).send({ error: "invalid color" });
      }
      db.prepare("UPDATE guests SET color = ? WHERE id = ?").run(body.color, guest.id);
    }
    const updated = db.prepare("SELECT * FROM guests WHERE id = ?").get(guest.id) as
      | { display_name: string; color: string; created_at: number }
      | undefined;
    refreshGuestCookie(reply, guest.id);
    return {
      id: guest.id,
      displayName: updated?.display_name ?? guest.display_name,
      color: updated?.color ?? guest.color,
      createdAt: updated?.created_at ?? guest.created_at,
    };
  });

  app.get("/api/streams/live", async () => {
    return listLiveStreams().map((row) => toSummary(row));
  });

  app.post("/api/streams", async (request, reply) => {
    if (!rateLimit(`create:${request.ip}`, 6, 60 * 60 * 1000)) {
      return reply.code(429).send({ error: "too many streams created from this address" });
    }
    const guest = ensureGuest(request, reply);
    const body = (request.body ?? {}) as { title?: unknown; category?: unknown };
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
    if (title.length < 3) return reply.code(400).send({ error: "title is too short" });
    const category =
      typeof body.category === "string" && CATEGORIES.has(body.category)
        ? body.category
        : "Just Chatting";
    const id = randomBytes(6).toString("hex");
    const hostKey = randomBytes(32).toString("base64url");
    const now = Date.now();
    db.prepare(
      `INSERT INTO streams
         (id, host_key_hash, guest_id, title, category, state, created_at)
       VALUES (?, ?, ?, ?, ?, 'idle', ?)`,
    ).run(id, hostKeyHash(hostKey), guest.id, title, category, now);
    const stream = getStream(id)!;
    return reply.code(201).send({ stream: toSummary(stream), hostKey });
  });

  app.get("/api/streams/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = getStream(id);
    if (!stream) return reply.code(404).send({ error: "stream not found" });
    const stats = stream.state === "live" ? await fetchSignalStats(id) : undefined;
    return toSummary(stream, stats);
  });

  app.post("/api/streams/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = requireHost(request, reply, id);
    if (!stream) return undefined;
    const now = Date.now();
    db.prepare(
      "UPDATE streams SET state = 'live', started_at = ?, ended_at = NULL WHERE id = ?",
    ).run(now, id);
    return { stream: toSummary(getStream(id)!) };
  });

  app.post("/api/streams/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = requireHost(request, reply, id);
    if (!stream) return undefined;
    const now = Date.now();
    db.prepare("UPDATE streams SET state = 'ended', ended_at = ? WHERE id = ?").run(now, id);
    return { stream: toSummary(getStream(id)!) };
  });

  app.get("/api/streams/:id/playback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = getStream(id);
    if (!stream) return reply.code(404).send({ error: "stream not found" });
    if (stream.state !== "live") {
      return reply.code(409).send({ error: "stream is not live", state: stream.state });
    }
    const token = mintPlaybackToken(id);
    const query = env.requirePlaybackToken ? `?t=${encodeURIComponent(token)}` : "";
    return {
      streamId: id,
      hlsPath: `/hls/live/${id}/index.m3u8${query}`,
      whepPath: `/api/streams/${id}/whep${query}`,
      token,
      p2p: true,
      state: stream.state,
    };
  });

  app.get("/api/streams/:id/host", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = requireHost(request, reply, id);
    if (!stream) return undefined;
    const stats = await fetchSignalStats(id);
    return { stream: toSummary(stream, stats) };
  });

  app.get("/api/streams/:id/stats", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = requireHost(request, reply, id);
    if (!stream) return undefined;
    const stats = await fetchSignalStats(id);
    const originMbps = getOriginMbps(id);
    const whepEntries = [...whepSessions.values()].filter(
      (session) => session.streamId === id && session.lastSeen >= Date.now() - WHEP_SESSION_TTL_MS,
    );
    // Real byte counts from the MediaMTX control API win; the client-reported
    // values only stand in when the control API is unreachable. Either way
    // the number feeding the budget guard is digits-first, not trust-first.
    const metered = mediaPoller.reachable;
    const whepMbps = metered
      ? whepEntries.reduce(
          (total, session) =>
            total +
            (session.meterObserved && session.meterAt > 0 ? session.meter.mbps() : 0),
          0,
        )
      : whepEntries.reduce((total, session) => total + session.reportedMbps, 0);
    const advisoryMbps = whepEntries.reduce((total, session) => total + session.reportedMbps, 0);
    return {
      viewers: stats.viewers,
      peers: stats.peers,
      edges: stats.edges,
      originMbps,
      originBudgetMbps: env.originBudgetMbps,
      health: computeHealth(stream.state, originMbps, env.originBudgetMbps, stats, whepMbps),
      state: stream.state,
      uptimeSeconds: stream.started_at ? Math.max(0, (Date.now() - stream.started_at) / 1000) : 0,
      whepSessions: whepEntries.length,
      whepMbps: Number(whepMbps.toFixed(2)),
      whepMbpsAdvisory: Number(advisoryMbps.toFixed(2)),
      whepMeterSource: metered ? "mediamtx-api" : "client-advisory",
    };
  });

  app.get("/api/streams/:id/manifest", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = getStream(id);
    if (!stream) return reply.code(404).send({ error: "stream not found" });
    return { streamId: id, hashes: getHashes(id), ts: Date.now() };
  });

  app.get("/api/streams/:id/recordings", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = requireHost(request, reply, id);
    if (!stream) return undefined;
    const dir = join(env.dataDir, "recordings", "live", id);
    return { recordings: walkRecordings(dir) };
  });

  app.get("/api/streams/:id/chat", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = getStream(id);
    if (!stream) return reply.code(404).send({ error: "stream not found" });
    return { messages: getChatHistory(id, 80) };
  });

  app.post("/api/streams/:id/telemetry", async (request, reply) => {
    if (!rateLimit(`telemetry:${request.ip}`, 120, 60 * 1000)) {
      return reply.code(429).send({ error: "too many events" });
    }
    const { id } = request.params as { id: string };
    const stream = getStream(id);
    if (!stream) return reply.code(404).send({ error: "stream not found" });
    const body = (request.body ?? {}) as { events?: unknown };
    const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
    for (const event of events) {
      const payload = event as { kind?: unknown; data?: unknown };
      if (typeof payload.kind !== "string") continue;
      insertTelemetry(id, payload.kind.slice(0, 40), payload.data ?? {});
    }
    return { ok: true, accepted: events.length };
  });

  app.post("/api/internal/chat", async (request, reply) => {
    const secret = request.headers["x-internal-secret"];
    if (secret !== env.internalSecret) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const body = (request.body ?? {}) as {
      id?: unknown;
      streamId?: unknown;
      guestId?: unknown;
      displayName?: unknown;
      color?: unknown;
      body?: unknown;
      createdAt?: unknown;
    };
    if (
      typeof body.id !== "string" ||
      typeof body.streamId !== "string" ||
      typeof body.guestId !== "string" ||
      typeof body.displayName !== "string" ||
      typeof body.body !== "string"
    ) {
      return reply.code(400).send({ error: "invalid message" });
    }
    if (!getStream(body.streamId)) {
      return reply.code(404).send({ error: "stream not found" });
    }
    if (body.body.length < 1 || body.body.length > 300) {
      return reply.code(400).send({ error: "invalid message length" });
    }
    if (!rateLimit(`chat:${body.guestId}`, 1, 1000)) {
      return reply.code(429).send({ error: "slow down" });
    }
    insertChat({
      id: body.id,
      streamId: body.streamId,
      guestId: body.guestId,
      displayName: body.displayName.slice(0, 24),
      color: typeof body.color === "string" ? body.color.slice(0, 9) : "#C9F73A",
      body: body.body,
      createdAt: typeof body.createdAt === "number" ? body.createdAt : Date.now(),
    });
    return { ok: true };
  });

  app.post("/api/streams/:id/whip", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = requireHost(request, reply, id);
    if (!stream) return undefined;
    const sdp = typeof request.body === "string" ? request.body : "";
    if (!sdp.includes("v=0")) {
      return reply.code(400).send({ error: "invalid SDP offer" });
    }
    let upstream: Response;
    try {
      upstream = await fetch(`${env.mediaWhipOrigin}/live/${id}/whip`, {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: sdp,
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return reply.code(502).send({
        error: "media server unavailable",
        hint: "Start MediaMTX with npm run media",
      });
    }
    const answer = await upstream.text();
    if (!upstream.ok) {
      return reply.code(upstream.status).send({
        error: "media server rejected the stream",
        detail: answer.slice(0, 500),
      });
    }
    return reply
      .code(upstream.status)
      .header("content-type", "application/sdp")
      .send(answer);
  });

  // Phase 4: direct WebRTC fallback playback, proxied to MediaMTX exactly
  // like the WHIP publish path. The playback handshake output (/playback)
  // carries a signed, stream-bound token that every session must present.
  // Gate order: 404 -> 409 state -> 403 token -> 429 rate (peek) -> 429 cap
  // -> 429 budget -> 400 SDP -> upstream. Only a successful creation charges
  // the rate window (peekRate instead of a blind charge), so rejected
  // attempts never consume the viewer's budget.
  app.post("/api/streams/:id/whep", async (request, reply) => {
    const { id } = request.params as { id: string };
    const stream = getStream(id);
    if (!stream) return reply.code(404).send({ error: "stream not found" });
    if (stream.state !== "live") {
      return reply.code(409).send({ error: "stream is not live", state: stream.state });
    }
    const token = typeof request.query === "object" && request.query !== null
      ? String((request.query as Record<string, unknown>).t ?? "")
      : "";
    if (env.requirePlaybackToken) {
      const tokenStream = token ? verifyPlaybackToken(token) : null;
      if (!tokenStream || tokenStream !== id) {
        return reply.code(403).send({ error: "invalid or missing playback token" });
      }
    }
    const rateKey = `whep:${request.ip}`;
    if (peekRate(rateKey) >= WHEP_RATE_MAX) {
      return reply.code(429).send({ error: "too many direct-media attempts" });
    }
    const guest = ensureGuest(request, reply);
    if (countWhepSessions(id) >= env.whepMaxSessions) {
      return reply.code(429).send({
        error: "direct WebRTC viewer cap reached for this stream",
        sessions: countWhepSessions(id),
      });
    }
    // Direct WebRTC egress draws from the same origin uplink as the HLS
    // proxy, so a creation only fits when the projected headline traffic
    // still fits the budget.
    const usedMbps = Number((getTotalOriginMbps() + totalWhepMbps()).toFixed(2));
    if (usedMbps + env.whepPerSessionMbps > env.originBudgetMbps) {
      return reply.code(429).send({
        error: "origin budget exhausted for direct playback",
        usedMbps,
        budgetMbps: env.originBudgetMbps,
      });
    }
    const sdp = typeof request.body === "string" ? request.body : "";
    if (!sdp.includes("v=0")) {
      return reply.code(400).send({ error: "invalid SDP offer" });
    }
    // The API mints its own accounting key up front and hands it to MediaMTX
    // as the `msid` query token: MediaMTX echoes the create request's query
    // onto the control-API session record (`session.query`), which is the one
    // deterministic way to bind the internal reader session to this row.
    const sessionId = randomBytes(16).toString("base64url");
    let upstream: Response;
    try {
      upstream = await fetch(
        `${env.mediaWhipOrigin}/live/${id}/whep?msid=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/sdp" },
          body: sdp,
          signal: AbortSignal.timeout(12_000),
        },
      );
    } catch {
      return reply.code(502).send({
        error: "media server unavailable",
        hint: "Start MediaMTX with npm run media",
      });
    }
    const answer = await upstream.text();
    if (!upstream.ok) {
      return reply.code(upstream.status).send({
        error: "media server rejected the direct playback",
        detail: answer.slice(0, 500),
      });
    }
    // Successful creation: this is the only point that consumes the rate
    // window. If a concurrent burst filled it meanwhile, tear the upstream
    // session back down instead of leaking it.
    if (!chargeRate(rateKey, WHEP_RATE_MAX, WHEP_RATE_WINDOW_MS)) {
      const location = upstream.headers.get("location") ?? "";
      const orphan = location
        .split("/")
        .filter(Boolean)
        .pop()
        ?.split("?")[0];
      if (orphan) {
        await fetch(`${env.mediaWhipOrigin}/live/${id}/whep/${orphan}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(5000),
        }).catch(() => undefined);
      }
      return reply.code(429).send({ error: "too many direct-media attempts" });
    }
    // The MediaMTX answer's WHEP Location token is what teardown needs; the
    // accounting row and every subsequent report/delete reference the msid
    // the route minted, which the control API also echoes back.
    const location = upstream.headers.get("location") ?? "";
    const deleteToken =
      location
        .split("/")
        .filter(Boolean)
        .pop()
        ?.split("?")[0] || sessionId;
    whepSessions.set(sessionId, {
      id: sessionId,
      streamId: id,
      guestId: guest.id,
      deleteToken,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      reportedMbps: 0,
      meterBytes: 0,
      meter: new ByteMeter(),
      meterObserved: false,
      meterAt: 0,
    });
    return reply
      .code(upstream.status)
      .header("content-type", "application/sdp")
      .header("x-whep-session-id", sessionId)
      .send(answer);
  });

  // Session accounting heartbeat: the viewer reads its inbound RTP byte
  // count from pc.getStats() and reports the delta every 10 s. These are
  // advisory numbers only — the origin budget is fed by the MediaMTX control
  // API — but reporting still keeps the session alive and gives a fallback
  // data point when the control API is unreachable.
  app.post("/api/streams/:id/whep/report", async (request, reply) => {
    if (!rateLimit(`whep-report:${request.ip}`, 15, 60 * 1000)) {
      return reply.code(429).send({ error: "too many reports" });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { sessionId?: unknown; mbps?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const session = sessionId ? whepSessions.get(sessionId) : undefined;
    if (!session || session.streamId !== id) {
      return reply.code(404).send({ error: "unknown direct-media session" });
    }
    const raw = Number(body.mbps);
    if (!Number.isFinite(raw) || raw < 0) {
      return reply.code(400).send({ error: "invalid bitrate sample" });
    }
    session.reportedMbps = Math.min(50, Math.round(raw * 100) / 100);
    session.lastSeen = Date.now();
    return {
      ok: true,
      sessions: countWhepSessions(id),
      meterSource: mediaPoller.reachable ? "mediamtx-api" : "client-advisory",
    };
  });

  // Session teardown: the session id itself is the capability here (it comes
  // from MediaMTX and is not guessable). Clear local accounting, then ask
  // MediaMTX to drop the session too.
  app.delete("/api/streams/:id/whep", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = typeof request.query === "object" && request.query !== null
      ? String((request.query as Record<string, unknown>).sid ?? "")
      : "";
    const session = sessionId ? whepSessions.get(sessionId) : undefined;
    if (!session || session.streamId !== id) {
      return reply.code(404).send({ error: "unknown direct-media session" });
    }
    whepSessions.delete(sessionId);
    try {
      // The control-API reader answers to its own WHEP Location token, not
      // the msid key that indexes the local table.
      await fetch(`${env.mediaWhipOrigin}/live/${id}/whep/${session.deleteToken}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // MediaMTX also closes reader sessions when the ICE connection dies;
      // local accounting is already released, so this is best effort.
    }
    return { ok: true, sessions: countWhepSessions(id) };
  });
}
