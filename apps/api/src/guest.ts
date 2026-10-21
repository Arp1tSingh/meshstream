import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db, getGuest, type GuestRow } from "./db";
import { env } from "./env";

export const GUEST_COOKIE = "ms_guest";

const COLORS = [
  "#C9F73A",
  "#5B9DFF",
  "#C084FC",
  "#FFB020",
  "#FF8A8E",
  "#3DDC97",
  "#67E8F9",
  "#F0ABFC",
];

const ADJECTIVES = [
  "Quiet",
  "Amber",
  "Swift",
  "Lunar",
  "Copper",
  "Velvet",
  "Static",
  "Neon",
  "Distant",
  "Glass",
  "Solar",
  "Wired",
  "Pale",
  "Rapid",
  "Soft",
  "Iron",
];

const NOUNS = [
  "Falcon",
  "Kite",
  "Signal",
  "Harbor",
  "Comet",
  "Lattice",
  "Echo",
  "Drift",
  "Cinder",
  "Vector",
  "Moth",
  "Relay",
  "Orbit",
  "Willow",
  "Packet",
  "Ember",
];

function generateName() {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]}${NOUNS[randomInt(NOUNS.length)]}${randomInt(10, 100)}`;
}

export function hashIp(ip: string) {
  return createHash("sha256").update(`${ip}:${env.cookieSecret}`).digest("hex").slice(0, 24);
}

export function createGuest(ip?: string): GuestRow {
  const now = Date.now();
  const guest: GuestRow = {
    id: randomBytes(9).toString("base64url"),
    display_name: generateName(),
    color: COLORS[randomInt(COLORS.length)] ?? "#C9F73A",
    ip_hash: ip ? hashIp(ip) : null,
    created_at: now,
    last_seen: now,
  };
  db.prepare(
    `INSERT INTO guests (id, display_name, color, ip_hash, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    guest.id,
    guest.display_name,
    guest.color,
    guest.ip_hash,
    guest.created_at,
    guest.last_seen,
  );
  return guest;
}

function setGuestCookie(reply: FastifyReply, id: string) {
  reply.setCookie(GUEST_COOKIE, id, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function ensureGuest(request: FastifyRequest, reply: FastifyReply): GuestRow {
  const raw = request.cookies[GUEST_COOKIE];
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) {
      const existing = getGuest(unsigned.value);
      if (existing) {
        db.prepare("UPDATE guests SET last_seen = ? WHERE id = ?").run(Date.now(), existing.id);
        return existing;
      }
    }
  }
  const guest = createGuest(request.ip);
  setGuestCookie(reply, guest.id);
  return guest;
}

export function refreshGuestCookie(reply: FastifyReply, guestId: string) {
  setGuestCookie(reply, guestId);
}

export function safeCompare(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return ha.length === hb.length && timingSafeEqual(ha, hb);
}

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  return true;
}
