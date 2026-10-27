import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env, PLAYBACK_TTL_SECONDS } from "./env";

const meters = new Map<string, ByteMeter>();
const hashes = new Map<string, Map<string, string>>();

export class ByteMeter {
  private samples: Array<{ t: number; n: number }> = [];

  add(bytes: number) {
    const now = Date.now();
    this.samples.push({ t: now, n: bytes });
    const cutoff = now - 12_000;
    while (this.samples.length && (this.samples[0]?.t ?? 0) < cutoff) this.samples.shift();
  }

  mbps(windowMs = 5000) {
    const now = Date.now();
    const since = now - windowMs;
    let bytes = 0;
    for (const s of this.samples) if (s.t >= since) bytes += s.n;
    return (bytes * 8) / (windowMs / 1000) / 1_000_000;
  }
}

export function getMeter(streamId: string) {
  let meter = meters.get(streamId);
  if (!meter) {
    meter = new ByteMeter();
    meters.set(streamId, meter);
  }
  return meter;
}

export function getOriginMbps(streamId: string) {
  return Number(getMeter(streamId).mbps().toFixed(2));
}

/** Every stream's HLS egress combined — the proxy uplink budget is shared. */
export function getTotalOriginMbps() {
  let total = 0;
  for (const meter of meters.values()) total += meter.mbps();
  return Number(total.toFixed(2));
}

export function rememberHash(streamId: string, pathname: string, buffer: Buffer) {
  let map = hashes.get(streamId);
  if (!map) {
    map = new Map();
    hashes.set(streamId, map);
  }
  map.set(pathname, createHash("sha256").update(buffer).digest("hex"));
  if (map.size > 240) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

export function getHashes(streamId: string) {
  return Object.fromEntries(hashes.get(streamId) ?? []);
}

export function mintPlaybackToken(streamId: string) {
  const exp = Math.floor(Date.now() / 1000) + PLAYBACK_TTL_SECONDS;
  const payload = `${streamId}.${exp}`;
  const sig = createHmac("sha256", env.playbackSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPlaybackToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [streamId, expRaw, sig] = parts;
  if (!streamId || !expRaw || !sig) return null;
  const payload = `${streamId}.${expRaw}`;
  const expected = createHmac("sha256", env.playbackSecret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expRaw) * 1000 < Date.now()) return null;
  return streamId;
}

function appendToken(uri: string, token: string) {
  if (!token) return uri;
  const separator = uri.includes("?") ? "&" : "?";
  return `${uri}${separator}t=${encodeURIComponent(token)}`;
}

function rewritePlaylist(body: string, token: string) {
  if (!token) return body;
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          if (uri.startsWith("data:") || uri.startsWith("http")) return `URI="${uri}"`;
          return `URI="${appendToken(uri, token)}"`;
        });
      }
      if (trimmed.startsWith("http")) return trimmed;
      return appendToken(trimmed, token);
    })
    .join("\n");
}

async function proxyHls(request: FastifyRequest, reply: FastifyReply) {
  const wildcard = String((request.params as Record<string, unknown>)["*"] ?? "");
  const path = `/${wildcard}`;
  const match = path.match(/^\/live\/([a-z0-9]{4,32})\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    return reply.code(400).send({ error: "invalid media path" });
  }
  const streamId = match[1]!;
  const file = match[2]!;
  if (file.includes("..")) {
    return reply.code(400).send({ error: "invalid media path" });
  }

  const token = typeof request.query === "object" && request.query !== null
    ? String((request.query as Record<string, unknown>).t ?? "")
    : "";
  if (env.requirePlaybackToken) {
    const tokenStream = token ? verifyPlaybackToken(token) : null;
    if (!tokenStream || tokenStream !== streamId) {
      return reply.code(403).send({ error: "invalid or missing playback token" });
    }
  }

  // MediaMTX's low-latency HLS uses a session id plus _HLS_msn/_HLS_part
  // blocking-reload parameters. Keep every MediaMTX query parameter and strip
  // only our playback token before proxying upstream.
  const upstreamQuery = new URLSearchParams();
  if (typeof request.query === "object" && request.query !== null) {
    for (const [key, raw] of Object.entries(request.query as Record<string, unknown>)) {
      if (key === "t" || raw === undefined) continue;
      if (Array.isArray(raw)) {
        for (const value of raw) upstreamQuery.append(key, String(value));
      } else {
        upstreamQuery.append(key, String(raw));
      }
    }
  }
  const queryString = upstreamQuery.toString();
  const target = `${env.mediaHlsOrigin}/live/${streamId}/${file}${queryString ? `?${queryString}` : ""}`;
  const range = request.headers.range;
  const headers: Record<string, string> = {};
  if (range) headers.range = range;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return reply.code(502).send({
      error: "media server unavailable",
      hint: "Start MediaMTX with npm run media",
    });
  }

  if (!upstream.ok) {
    return reply.code(upstream.status === 404 ? 404 : 502).send({
      error: upstream.status === 404 ? "stream segment not found" : "media server error",
    });
  }

  const isPlaylist = file.endsWith(".m3u8");
  const contentType =
    upstream.headers.get("content-type") ??
    (isPlaylist ? "application/vnd.apple.mpegurl" : "application/octet-stream");

  reply
    .code(upstream.status)
    .header("content-type", contentType)
    .header("cache-control", isPlaylist ? "no-store" : "public, max-age=20")
    .header("x-content-type-options", "nosniff");

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) reply.header("content-range", contentRange);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) reply.header("accept-ranges", acceptRanges);

  if (isPlaylist) {
    const text = await upstream.text();
    return reply.send(rewritePlaylist(text, token));
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  getMeter(streamId).add(buffer.byteLength);
  rememberHash(streamId, path, buffer);
  const length = upstream.headers.get("content-length");
  if (length) reply.header("content-length", length);
  return reply.send(buffer);
}

export async function registerHlsRoutes(app: FastifyInstance) {
  app.get("/hls/*", proxyHls);
}
