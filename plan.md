# MeshStream — Build Plan

**Live video that travels light.**

MeshStream is a browser-based live streaming app where viewers relay the video to each other over WebRTC. One creator goes live; the audience becomes part of the delivery network. No accounts, no sign-up, no paid infrastructure — a single home machine can run the whole thing behind a free Cloudflare tunnel.

| | |
|---|---|
| **Status** | Blueprint, ready to build |
| **Working name** | MeshStream |
| **Platform** | Web app, desktop-first (studio requires a desktop browser) |
| **v1 video** | 1280×720 @ 30fps, H.264 ~2.5 Mbps, Opus 96–128 kbps |
| **Hosting** | Local Windows machine + Cloudflare Quick Tunnel, $0 |
| **Auth** | None. Guest identity only. Host control via a device-local secret key |
| **Signature UI** | Dark broadcast studio + live swarm visualizer + animated "How it works" page |

---

## 0. Decisions locked

| Decision | Choice |
|---|---|
| Product | One-to-many live broadcast with peer-assisted delivery |
| Product name | **MeshStream** |
| Accounts | **None.** Guest profiles, auto-created on first visit |
| Hosting | **Local device as server**, free Cloudflare tunnel |
| Origin media server | MediaMTX (single binary, Windows-ready) |
| Distribution format | Low-Latency HLS (fMP4), 400 ms parts, 1 s segments |
| Client player | hls.js + MSE with a custom P2P part loader |
| P2P transport | WebRTC data channels (direct, no TURN in v1) |
| Persistence | SQLite (WAL) + local disk for recordings |
| v1 quality | 720p single rendition, no transcoding |
| Frontend | Next.js 15 + TypeScript + Tailwind v4 + Radix + Motion |
| Explainer | `/how-it-works`, scroll-driven animated page + live simulator |

---

## 1. Product

### The pitch

Twitch-style live streaming is expensive because every viewer costs egress. MeshStream turns viewers into distributors: the stream is cut into small parts, and each viewer passes parts to a few others over WebRTC. The origin only needs to seed the swarm and cover failures.

The product makes that invisible machinery **visible and understandable** — a swarm panel in the player, a health score in the studio, and an animated explainer page that teaches the model in 60 seconds.

### v1 scope

- Go live from the browser in under 30 seconds: camera/screen, mic, 720p.
- Public share link; anyone can watch without an account.
- Guest display name + color for chat and presence.
- Peer-assisted delivery with graceful fallback to the origin.
- Live studio telemetry: bitrate, dropped frames, health, viewers, peers, origin load.
- Viewer swarm panel: P2P %, bytes saved, peer mesh, source breakdown.
- Chat with moderation basics.
- Local recordings with a simple library.
- Animated `/how-it-works` page with an interactive simulator.
- Runs on one Windows machine, starts on boot, reachable via HTTPS.

### Non-goals for v1

- Real accounts, OAuth, email, profiles, follows across devices.
- DRM, monetization, subscriptions, ads.
- Mobile studio, native apps.
- Multi-region, managed CDN, ABR ladder.
- TURN relay infrastructure (failed peer connections simply use the origin).
- VOD transcoding pipelines, clips editor, live captions.
- Seamless failover across multiple origin machines.

### Success definition

A stranger opens a link on their phone or laptop and watches a 720p stream within 3 seconds; 10+ viewers can watch from a home connection while the origin serves less than half the bytes; the UI explains exactly what is happening without a manual.

---

## 2. Brand and visual direction

**Name:** MeshStream — lowercase wordmark `meshstream` in Inter Tight 600, tracking −0.02em.
**Glyph:** three lime nodes connected in a triangle, one edge brighter (the relay path).
**Tagline:** *The audience is the network.*
**Voice:** direct, technical, quietly confident. No growth-hack exclamation marks.

### Visual principles

1. **The video is the only bright thing.** Chrome stays near-black; color is reserved for meaning.
2. **Dense, not noisy.** Every pixel of the studio earns its place. Tabular numbers, hairline rules, no decorative gradients.
3. **State is designed.** Armed, live, degraded, reconnecting, origin-only, swarm saturated — each has a deliberate look.
4. **Motion explains, never decorates.** 120–200 ms transitions; packets move because data moves.
5. **Honest telemetry.** If P2P is off, the UI says "Origin" — never a fake peer count.

---

## 3. Architecture

### 3.1 Services

```
Browser Studio ──WHIP (WebRTC)──▶ MediaMTX ──▶ LL-HLS (fMP4)
      │                              │              │
      │                         recordings      edge proxy (API)
      ▼                              │              │
 Studio WS / API ◀──── SQLite ───────┘              ▼
      │                                          Browser Viewer
      │                                            │      │
      └──────── Signal WS ◀────────────────────────┘      │
                    │                                     │
                    └──── WebRTC data channels ◀──────────┘
                          (viewer ↔ viewer, direct)
```

| Service | Tech | Responsibility |
|---|---|---|
| `web` | Next.js 15, React 19 | Studio, viewer, landing, explainer, library |
| `api` | Fastify + Drizzle + SQLite | Guest sessions, streams, chat, recordings, telemetry, HLS edge proxy |
| `signal` | Node + `ws` | Swarm assignment, SDP/ICE relay, presence, health |
| `media` | MediaMTX | WHIP ingest, LL-HLS packaging, recording |
| `proxy` | Caddy | Single origin, path routing, caching, WebSocket upgrade |
| `tunnel` | cloudflared | Free public HTTPS/WSS entrypoint |
| `jobs` | Node worker | Recording finalize, thumbnails, retention cleanup |

No Redis, no Postgres in v1. SQLite in WAL mode and in-process state are enough for a single machine and up to a few hundred viewers.

### 3.2 Free hosting on this device

```
Internet
   │ HTTPS / WSS
   ▼
Cloudflare edge  ──quick tunnel──▶  cloudflared
                                       │
                                       ▼
                                  Caddy :8080
             ┌──────────┬──────────┬──┴───────┬───────────┐
             ▼          ▼          ▼          ▼           ▼
          Next :3000  API :4000  WS :4001  HLS :8888  WHIP :8889
                                                  │
                                              MediaMTX
```

- **One public origin.** Caddy routes `/` → web, `/api` → API, `/ws` → signal, `/hls` → media, `/whip` → media. Everything same-origin, so no CORS and one TLS endpoint.
- **Cloudflare Quick Tunnel** (`cloudflared tunnel --url http://localhost:8080`) provides free HTTPS and WebSockets with no account. It is the only public entrypoint; no router ports are opened.
- **Peer traffic bypasses the tunnel.** WebRTC data channels connect viewers directly over UDP via STUN. Only signaling, playlists, and fallback parts use the tunnel.
- **HLS goes through the API's edge proxy**, not straight from MediaMTX. This makes every origin byte countable, enforces signed playback tokens, and gives the swarm its offload metric.

**Free-tier realities (accepted for v1):**

| Constraint | Impact | Mitigation |
|---|---|---|
| Quick Tunnel URL changes on restart | Shared links die | Show current link in studio; optional $10/yr domain + named tunnel later |
| 200 in-flight requests per tunnel | Bursts can 429 | 400 ms parts, P2P-first, playlist/part caching, request coalescing |
| No SSE support | — | Use WebSockets only |
| No uptime guarantee | Stream can drop | Local recovery, auto-restart services, LAN fallback URL |
| Home upload 10–40 Mbps | Origin is the bottleneck | 720p, 3 origin seed children, origin guard, P2P tree |
| Device must stay awake | Downtime | Power plan, NSSM services, boot auto-start |
| No free TURN | Some pairs can't connect | Those viewers stay origin-only; TURN optional later |

**Stable-link option:** if a domain is ever available, a named Cloudflare Tunnel is still free and keeps a permanent hostname. The architecture does not change.

### 3.3 Windows host operations

- Run API, signal, web, Caddy, MediaMTX, and cloudflared as Windows services via NSSM.
- Disable sleep/hibernate: `powercfg /change standby-timeout-ac 0`.
- Start order: Caddy → API → signal → web → MediaMTX → cloudflared. Each service exposes `/healthz`; Caddy waits for API.
- Logs to `./data/logs/*.log` with rotation; SQLite backup nightly via `sqlite3 .backup`.
- Install as three scripts: `scripts/dev.ps1`, `scripts/start-all.ps1`, `scripts/install-services.ps1`.
- LAN fallback: `http://<lan-ip>:8080` for local debugging (browser mic/camera requires localhost or HTTPS, so remote LAN devices need the tunnel).

---

## 4. Media pipeline — 720p

### Publish

- Browser studio: `getUserMedia` (1280×720, 30fps) or `getDisplayMedia` for screen share.
- Single H.264 track ~2.5 Mbps (2.2–3.0 adaptive ceiling) + Opus 96–128 kbps.
- Publish over **WHIP** to MediaMTX. Studio caps bitrate with `RTCRtpSender.setParameters`, monitors `getStats()`, and warns when uplink is short.
- MediaMTX path per stream: `/live/<streamId>`. Publish allowed only with a short-lived media JWT minted for the host key holder.
- **No transcoding in v1.** 720p in, 720p out; CPU cost is packaging only. This is what makes a home machine viable.

### Package

MediaMTX config essentials:

```yaml
hls: yes
hlsAddress: :8888
hlsVariant: lowLatency
hlsSegmentDuration: 1s
hlsPartDuration: 400ms   # fewer requests than 200ms; respects the tunnel
hlsSegmentCount: 7
hlsAlwaysRemux: yes      # ready before the first viewer
hlsDirectory: ./data/hls  # disk-backed, enables CDN-style serving later
webrtc: yes
webrtcAddress: :8889
```

- fMP4 parts, 400 ms, 1 s segments, 7-segment window (7 s DVR).
- Playlist and parts served same-origin through the API edge proxy with cache headers and byte accounting.
- Integrity manifest: the edge hashes each published part and exposes a short-lived, HMAC-signed manifest window for peers to verify transfers.

### Play

- hls.js with Low-Latency mode, `liveSyncDurationCount` tuned to ~2.5 s buffer.
- Target glass-to-glass: **2.5–4 s**.
- Latency budget: capture 33 ms → encode 80 ms → WHIP 120 ms → packaging 900 ms → network/P2P 600 ms → decode 150 ms.
- iOS/Safari: native HLS fallback, P2P off, UI states "Origin only · Safari".
- 720p only: quality menu shows 720p and "Auto (720p)" — no fake ladder.

### Record

- MediaMTX `record: yes`, fMP4 to `./data/recordings/<streamId>/`.
- Worker finalizes after stream end: remux to MP4 with faststart, extract poster at 2 s, compute duration/size.
- Retention: 7 days by default (configurable). ~1.1 GB per hour at 2.5 Mbps.
- Library is scoped by the host key held in this browser; recordings are not a public VOD platform.

---

## 5. P2P swarm

### 5.1 Topology

Not a full mesh. The origin is the root of a **distribution tree with mesh repair**:

- Each viewer has **1–2 parents** and **up to 4 children**.
- The origin accepts at most **3 direct seed children** (configurable), chosen for stable RTT and measured upload.
- New viewers prefer the healthiest peer with spare capacity and the part they need.
- On churn, children re-parent within 1 part interval; if no peer can serve, the origin covers the gap.
- Target: 10–60 viewers on a typical home uplink, with 50–70% offload.

### 5.2 Protocol

Shared Zod-typed messages in `packages/protocol`:

```
hello        { guestId, streamId, caps }
assign       { parents[], children[], iceServers[] }
have         { bitmap }                  // on connect + on each new part
want         { partId, deadline, priority }
data         { partId, offset, chunk }   // 16 KiB chunks
cancel       { partId }
nack         { partId, reason }
quarantine   { peerId, reason }
ping / pong  { t }
```

- Two data channels per pair: `control` (reliable/ordered) and `data` (unordered).
- 16 KiB chunks with `bufferedAmountLowThreshold` backpressure.
- Cache: ~60 s of parts per tab; keyed `(streamId, rendition, seq, part)`.
- Parts are short-lived. Peers at the live edge exchange the newest parts; a peer more than ~4 s behind is told to sync to live edge rather than backfill.

### 5.3 Source selection

For every needed part:

1. **Local cache** — instant.
2. **Peer** — lowest p95 fetch time among parents/children that advertise the part.
3. **Origin** — the safety net.

A part has a hard deadline (arrival + ~1.6 s). Miss it, cancel peer requests, fetch from origin. Origin is never removed from the path, only minimized. The player must never stall because P2P was attempted; added rebuffering versus origin-only is a release blocker.

### 5.4 Upload policy

A peer serves only when:

- Buffer > 15 s.
- Tab is visible (`document.visibilityState`).
- Measured uplink utilization < 70%.
- Not on a metered connection (Network Information API where available).
- Contribution score is healthy; persistent leeches degrade to origin-only.

Tit-for-tat: upload contribution raises a peer's priority when choosing parents. This prevents pure free-riding without punishing weak devices.

### 5.5 Origin guard

The edge proxy counts bytes per second. If origin egress exceeds the configured upstream budget (default 12 Mbps):

- Stop granting new origin parents.
- Tell the swarm to rebalance (`swarm:saturated`).
- Studio shows "Origin saturated — new viewers may buffer".
- The UI prefers higher latency over rebuffering.

### 5.6 Integrity and access

- **Access:** short-lived signed playlist/part URLs bound to stream + session; peers receive only URLs the viewer already has.
- **Transport:** DTLS on every data channel.
- **Integrity:** sidecar HMAC-signed hash manifest; SHA-256 verified before cache insert; first-seen parts require 2-source agreement; mismatches quarantine the sender.
- **Signaling:** every SDP/ICE message is validated against swarm membership and rate-limited.
- **Abuse:** per-IP limits on stream creation, chat, and signaling; guest cookies signed; no PII.

### 5.7 Failure modes

| Failure | Behavior |
|---|---|
| Peer disconnects | Children re-parent; origin covers until repaired |
| Peer sends corrupt part | Hash mismatch → discard, quarantine, retry another source |
| Data channel never connects | Viewer stays origin-only; UI shows "Direct connection unavailable" |
| Tab backgrounded | Peer stops serving; children rebalance |
| Origin saturated | New peers wait/rebalance; existing streams protected |
| Origin offline | Player shows reconnect state; stream ends after grace period |

### 5.8 Client integration

`packages/player` wraps hls.js and overrides the part/fragment loaders. The loader checks the swarm cache, asks peers, and falls back to the default loader on deadline. `packages/swarm` is framework-agnostic TypeScript with no React imports, so it can run in a headless simulator.

---

## 6. Guest identity (no auth)

No sign-up, no email, no password.

### Identity lifecycle

1. First request: API sets a signed `ms_guest` cookie (HttpOnly, SameSite=Lax, 30 days) containing `guestId`, display name, and avatar color.
2. Display name is generated (`QuietFalcon`, `AmberKite`, …) plus a deterministic color; editable at any time.
3. Viewing requires no name prompt. A name prompt appears only when chatting or going live.
4. Profile cached in localStorage for instant UI; the cookie stays authoritative.

### Host control

- Creating a stream returns a random **host key** (32 bytes). The browser stores it in localStorage and an HttpOnly cookie; the server stores only its hash.
- The studio requires the host key. A "restore host key" field allows moving control to another browser.
- Losing the key loses control of that stream; streams are ephemeral by design.
- Publish tokens are minted only for a valid host key and bound to the stream path.

### Moderation

- The host can promote a guest to moderator; the mod receives a scoped token.
- Mod actions: delete message, timeout guest (by guest ID/IP hash), slow mode, lock chat.
- Host can end the stream at any time from any device holding the key.

### Honest limitations

- Clearing browser data loses host control and local library access.
- Guest identity is device-bound; the same person on two devices is two guests.
- Without accounts, abuse defense is rate limits, signed cookies, hashed IPs, and optional Cloudflare Turnstile on stream creation.

---

## 7. Data model and API

### SQLite schema (Drizzle)

| Table | Key fields |
|---|---|
| `guests` | `id` (ULID), `display_name`, `color`, `ip_hash`, `created_at`, `last_seen` |
| `streams` | `id`, `host_key_hash`, `title`, `category`, `state`, `started_at`, `ended_at`, `settings_json`, `peak_viewers` |
| `chat_messages` | `id`, `stream_id`, `guest_id`, `body`, `created_at`, `deleted_at` |
| `moderators` | `stream_id`, `guest_id`, `token_hash`, `created_at` |
| `view_sessions` | `id`, `stream_id`, `guest_id`, `joined_at`, `left_at`, `peer_bytes`, `origin_bytes`, `rebuffers`, `avg_latency` |
| `recordings` | `id`, `stream_id`, `path`, `duration_s`, `size_bytes`, `poster_path`, `created_at` |
| `telemetry_events` | `id`, `stream_id`, `kind`, `payload_json`, `created_at` |
| `rate_limits` | in-memory map + SQLite fallback for restart durability |

### REST (Fastify)

```
POST   /api/guest                 create/refresh guest cookie
PATCH  /api/guest                 name, color
POST   /api/streams               create stream (rate-limited) → { id, hostKey }
POST   /api/streams/:id/start     host key required
POST   /api/streams/:id/stop      host key required
POST   /api/streams/:id/publish   mint media JWT + WHIP URL
GET    /api/streams/live          landing page data
GET    /api/streams/:id           metadata
GET    /api/streams/:id/playback  signed HLS URL + swarm token
GET    /api/streams/:id/manifest  signed part-hash manifest window
POST   /api/streams/:id/telemetry batch client events
GET    /api/recordings            host-key scoped
POST   /api/mod/:streamId/...     moderator actions
GET    /hls/*                     edge proxy: token check, byte count, cache
```

### WebSockets

| Endpoint | Purpose |
|---|---|
| `/ws/signal?stream=` | Swarm assignment, SDP/ICE, rebalance, presence |
| `/ws/studio?stream=` | Health, viewers, chat, alerts (host token) |
| `/ws/chat?stream=` | Chat messages, deletions, slow mode |

Heartbeat every 25 s (Cloudflare idle timeout safety). Reconnect with jittered backoff; resume presence by guest ID.

---

## 8. UI blueprint

### 8.1 Design tokens

```css
--bg-0:#07080A; --bg-1:#0D0F13; --bg-2:#13161C; --bg-3:#1A1E26;
--line:#232833; --line-strong:#323947;
--text-1:#ECEEF2; --text-2:#9AA1AE; --text-3:#6A7280;
--accent:#C9F73A;  /* signal lime; on-accent text #0A0B0D */
--live:#FF5A5F; --ok:#3DDC97; --warn:#FFB020; --info:#5B9DFF;
--r-sm:6px; --r-md:10px; --r-lg:14px;
--dur:150ms; --ease:cubic-bezier(.2,.8,.2,1);
```

- **Type:** Inter Tight (display, 600, tight tracking), Inter (UI/body 13–15 px), JetBrains Mono (all telemetry, timestamps, IDs). Self-hosted variable fonts.
- **Surfaces:** 1px hairlines, faint top inner highlight, 2% grain, no drop shadows except floating layers.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere metrics appear.
- **Spacing:** 4 px base, 8 px rhythm; 12-column desktop grid; 240 px sidebar, 320 px inspector.
- **Focus:** 2 px lime ring, 2 px offset, always visible for keyboard.
- **Accent discipline:** lime = primary action, focus, P2P healthy. Red = live or destructive only.

### 8.2 App map

| Route | Purpose |
|---|---|
| `/` | Landing: live now, what MeshStream is, CTA to watch or go live |
| `/how-it-works` | Animated explainer + interactive swarm simulator |
| `/studio` | Preflight: name, devices, network check, 720p locked |
| `/studio/:id` | Live studio: scenes, preview, health, chat, on-air controls |
| `/c/:handle` | Public channel/stream page (ephemeral) |
| `/watch/:id` | Viewer with swarm panel |
| `/library` | Local recordings, host-key scoped |
| `/settings` | Guest name/color, stream defaults, tunnel link, retention |
| `/mod/:id` | Moderator console (token-gated) |

### 8.3 Studio layout

```
┌ rail 64 ┬ sources 248 ┬──────── stage ────────┬ inspector 328 ┐
│ Studio  │ Scenes        │  preview 16:9          │ ON AIR   02:14│
│ Live    │ Camera/Screen │  safe guides           │ 2.5 Mbps ▁▂▃  │
│ Library │ Overlays      │                        │ Peers 12 · A  │
│ Stats   │               ├─ audio strips ─────────┤ Chat / Alerts │
└─────────┴───────────────┴────────────────────────┴───────────────┘
```

- Desktop-only studio (≥1280 px). Below that, a clean "Studio needs a larger screen" state with a viewer link.
- **Go live** is a guarded sequence: preflight checklist → armed state → 3-2-1 countdown → on-air mode.
- **On-air mode:** top hairline turns red, chrome dims, navigation requires confirmation, "End stream" is the only destructive action, `Esc` never exits.
- **Health score A–F** from bitrate stability, dropped frames, RTT, origin saturation, peer ratio. Every score below B comes with a plain-language fix.
- **Origin guard meter:** "Origin 4.2 / 12 Mbps" — the number that matters on a home connection.
- Camera/screen source switching, mic level meters, device pickers, local recording toggle.
- Inline chat with slow mode and mod actions.

### 8.4 Viewer layout

```
┌ topbar: channel · LIVE · 12 peers · share ─────────────────────┐
│ ┌──────────── player 16:9 ────────────┬ chat 360 ─────────────┐ │
│ │  lower-third / captions              │ messages              │ │
│ │                                      │ composer              │ │
│ └──────────────────────────────────────┴───────────────────────┘ │
│ tabs: About · Swarm · Chat · Recordings                          │
└──────────────────────────────────────────────────────────────────┘
```

- Player controls: play/pause, volume, quality (720p/Auto), latency-to-live, sync to live edge, theater, fullscreen.
- **Signature swarm panel:** P2P ring, "68% from peers · 1.4 GB saved", peer count, a force-directed mesh that pulses on transfer, and a source bar (peers / cache / origin).
- Degrades honestly: `P2P 68%` → `Direct connection unavailable` → `Origin only`. Tooltip explains why (Safari, firewall, background tab).
- Chat: dense rows, mono timestamps, guest color chip, badges for host/mod, slow-mode indicator, keyboard shortcut to focus composer.
- Mobile viewer: chat collapses to a tab; player fills width; touch targets ≥44 px.

### 8.5 Component inventory

Buttons (primary/secondary/ghost/danger/icon) · toggles · segmented control · slider · stepper · inputs · select/combobox · tooltip · popover · dialog · sheet · toast · tabs · badges (LIVE/REC/PEER) · status dot · meter · sparkline · metric tile · data table · avatar stack · command palette · media card · chat row/composer · player controls · quality menu · mesh graph · preflight row · device selector · countdown overlay · empty state · health score chip.

Build on Radix primitives, styled entirely with our tokens. shadcn is a reference, not a look.

### 8.6 States to design explicitly

- Guest first visit, name prompt, name saved.
- Preflight incomplete, permission denied (per device), unsupported browser, no camera, no mic.
- Connecting, buffering, healthy, degraded, reconnecting, on-air, ending.
- Swarm: forming, healthy, rebalancing, origin-only, origin saturated, Safari fallback.
- Empty library, empty chat, stream ended, stream not found, tunnel offline.
- Every error state has a next action — never a dead end.

### 8.7 Motion and accessibility

- 150 ms standard, 220 ms sheets, spring for drawers; `prefers-reduced-motion` disables pulses, counters, and mesh motion.
- `aria-live` for on-air, connection, and viewer-count changes.
- Full keyboard player; `?` opens shortcut sheet.
- AA contrast validated per token pair; small red text uses `#FF8A8E`.
- Captions track supported by the player from day one even if generation comes later.
- Focus never trapped in the studio; on-air confirmations are the only modals.

### 8.8 Keyboard map

`⌘K` command palette · `M` mute · `V` camera · `S` screen · `R` local record · `L` go live (confirm) · `C` chat · `F` fullscreen · `?` shortcuts · `Esc` close layer (never end stream).

---

## 9. `/how-it-works` — animated explainer page

### Goal

Teach the entire system in under 60 seconds, make the P2P idea feel obvious, and let skeptics play with it. This page is part of the product, not a generic marketing page — same dark studio language, real numbers, restrained motion.

### Structure

Sticky 100vh stage with scroll-driven scenes (desktop), stacked animated cards (mobile). A thin progress rail and step index on the left; "Replay" and "Skip to simulator" controls; every scene has a one-sentence caption. No narration, no autoplay audio.

| # | Scene | Visual | Copy |
|---|---|---|---|
| 0 | Hero | A sparse node field snaps into a mesh; three nodes brighten into a triangle glyph | **The audience is the network.** Live video that travels light. |
| 1 | One stream in | Camera card → origin card; one lime ribbon | **One camera. One origin.** You publish 720p from your browser. |
| 2 | Sliced | The ribbon fragments into a filmstrip of 1 s parts | **Live video, cut into seconds.** Every part has an address and a hash. |
| 3 | Swarm forms | Viewers appear; lines snap into a tree around the origin | **The audience becomes the network.** Each viewer passes parts to a few others. |
| 4 | Parts travel | Packets run along edges; origin egress meter falls from 100% to ~30% | **Pieces travel sideways.** The origin seeds the swarm, then steps back. |
| 5 | Safety net | A peer fails; children reroute; origin briefly covers the gap | **Always a safety net.** If a peer disappears, the origin covers the gap. |
| 6 | Simulator | Interactive panel | **Try it yourself.** Change the audience, kill a peer, see what happens. |
| 7 | CTA | Mesh collapses back to the glyph | **Go live in your browser.** No account. 30 seconds. |

### Interactive simulator

- Origin + up to 50 peer dots; deterministic tree model mirroring the real scheduler.
- Controls: viewer count slider, P2P on/off, "kill a random peer", "slow network".
- Live readouts: origin egress (Mbps), P2P offload %, peers serving, rebuffer risk.
- Clearly labeled **"Simulation — modeled on the live scheduler"** so it never claims to be real traffic.
- Toggling P2P off shows origin egress spike; killing peers shows recovery. This is the "aha" moment.

### Technical approach

- Next.js route with a client-only stage; lazy-loaded below the fold.
- **Motion** (`useScroll`, `useTransform`, `useSpring`) for scroll progress; SVG paths with `stroke-dasharray` draw-on; transform/opacity only.
- Node positions computed in a deterministic layout; packets are 4 px lime capsules animated along quadratic paths.
- One `<canvas>` only if node counts exceed ~80; otherwise SVG for crispness.
- Counters animate with `requestAnimationFrame`; no layout thrash.
- `prefers-reduced-motion`: scenes become static diagrams with the full step list and a "Play animations" button. Simulator still works.
- Keyboard: step navigation with arrow keys, visible focus, pause control.
- Performance budget: ≤120 KB gz additional JS on this route; 60 fps on a 2019 laptop; CLS 0.
- Accessibility: semantic headings per scene, SVG `role="img"` + descriptions, simulator controls labeled, status announced politely.
- Instrumentation: scene completion and simulator interactions as anonymous events, to improve the page.

### Visual details

- Background: same `--bg-0` with a slow-drifting 24 px grid at 4% opacity; a soft radial vignette behind the stage.
- Origin: stacked graphite card with a lime status line; peers: 12 px circles with generated initials and guest colors.
- Edges: 1 px `--line-strong`; active transfers brighten to lime with a 600 ms fade.
- Failure: a 120 ms red flash and a dashed "rerouting" path before the mesh heals.
- The page ends by reusing the same swarm graph component as the viewer panel — code shared, not duplicated.

### Acceptance criteria

- 60 fps scroll on a mid-range laptop; no jank at scene transitions.
- Meaning is clear with animations off (static fallback is a complete explanation).
- Simulator is honest, deterministic, and works on touch.
- Lighthouse performance ≥ 90, accessibility ≥ 95 on the route.

---

## 10. Repo and stack

```
apps/
  web/        Next.js 15, React 19, Tailwind v4, Radix, Motion
  api/        Fastify, Drizzle, SQLite, HLS edge proxy
  signal/     ws, swarm coordinator
packages/
  ui/         tokens, primitives, studio + viewer components
  player/     hls.js wrapper, P2P loaders
  swarm/      transport, scheduler, scoring, cache (no React)
  protocol/   Zod schemas, shared types
  config/     tsconfig, eslint, tailwind preset
services/
  mediamtx/   config + paths
  caddy/      Caddyfile
  scripts/    PowerShell dev/start/install-services
  simulator/  headless peer harness
data/         sqlite, hls, recordings, logs (gitignored)
```

- pnpm + Turborepo, TypeScript strict.
- TanStack Query for server state, Zustand for realtime UI state.
- uPlot for dense telemetry; custom SVG for sparklines and the mesh.
- Vitest, Playwright (visual + E2E), Storybook for the token/component layer.
- No component library that imposes a look. We own the pixels.

---

## 11. Milestones

Solo estimate: 10–12 weeks to a public beta. Two engineers + part-time designer: 7–8 weeks.

### M0 — Foundations (week 1)

- Monorepo, strict TS, Tailwind tokens, Storybook, app shell.
- Guest cookie + name modal, SQLite schema, API health checks.
- Caddy + MediaMTX configs committed; local dev scripts.
- **Exit:** `pnpm dev` boots web/api/signal; guest identity persists; token page renders.

### M1 — Live at 720p (weeks 2–3)

- Studio capture/preview, device selection, preflight.
- WHIP publish with host token; stream create/start/stop; share link.
- MediaMTX LL-HLS, API edge proxy, hls.js player, landing "live now".
- Cloudflare tunnel script; end-to-end test from a phone on cellular.
- **Exit:** two remote devices watch a 720p stream for 10 minutes; p95 latency < 4 s.

### M2 — Swarm (weeks 4–6)

- Signal service, swarm assignment, SDP/ICE relay.
- Protocol + data channels + part scheduler + origin guard.
- hls.js P2P loaders, hash manifests, quarantine, telemetry.
- Mesh panel in viewer; headless simulator with 50 peers.
- **Exit:** 3 browsers + 30 simulated peers; offload ≥ 50%; rebuffer ≤ origin-only + 0.2%; origin egress under cap.

### M3 — Pro UI + explainer (weeks 6–8)

- On-air mode, health, origin meter, alerts, command palette.
- Chat + moderation, library/recordings, settings, empty/error states.
- `/how-it-works` page, all scenes + simulator, landing polish.
- Accessibility and keyboard pass; reduced-motion fallback.
- **Exit:** design QA checklist passed; axe clean; explainer 60 fps; simulator deterministic.

### M4 — Hardening + free-host ops (weeks 8–10)

- Reconnect/backoff, tab visibility, backpressure, churn tests.
- Windows services, boot auto-start, power settings, log rotation, backups.
- Rate limits, CSP, stream hijack tests, tunnel outage behavior.
- Load test 100 simulated viewers; recording finalize + retention.
- Optional: 480p rendition, TURN, named tunnel.
- **Exit:** 72-hour soak; auto-recovery after reboot; runbook written.

### M5 — Beta (week 10+)

- 10–20 real viewers, 3–5 streams, measure offload and complaints.
- Fix list, SLO verification, cost/upstream report.
- **Exit:** SLOs held for two consecutive weeks.

---

## 12. Testing and observability

- **Unit:** scheduler, scoring, cache, manifest verification, guest tokens.
- **Integration:** WHIP publish → HLS part → proxy → player; host key enforcement.
- **Swarm simulator:** 50 virtual peers over loopback with `werift`/`node-datachannel`; kill/throttle/TURN-only scenarios.
- **E2E:** Playwright on Chromium + Firefox, one Safari smoke test; visual snapshots of studio, viewer, explainer.
- **Chaos:** stop media server, kill 30% of peers, saturate origin, rotate tunnel URL.
- **Observability:** structured logs, `/healthz`, local metrics page (viewers, origin Mbps, offload, p95 latency, rebuffer, tunnel 429s), Sentry optional.
- **Client telemetry:** join time, startup time, latency, peer ratio, rebuffer count, source breakdown — batched, anonymous.

---

## 13. SLOs and targets

| Metric | Target |
|---|---|
| Glass-to-glass latency p95 | < 4 s (goal 3 s) |
| Join/start time p95 | < 2.5 s |
| Rebuffer ratio | < 1% (and ≤ origin-only) |
| P2P offload at 20+ viewers | ≥ 55% |
| Origin egress | ≤ 12 Mbps at 30 viewers |
| Host CPU (720p, no transcode) | < 25% on 8 cores |
| Crash-free sessions | > 99.5% |
| Explainer FPS | 60 on 2019 laptop |
| Accessibility | axe 0 serious, Lighthouse a11y ≥ 95 |

---

## 14. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Quick Tunnel rotates URL / no SLA | High | Link banner in studio, named tunnel later, LAN fallback |
| 200 in-flight tunnel cap | High | 400 ms parts, P2P-first, caching/coalescing, load test, 429 telemetry |
| Home upstream too small | High | 720p, 3 origin seeds, origin guard, tree topology, honest UI |
| PC sleeps or reboots | High | NSSM services, power plan, boot auto-start, health checks |
| No TURN → some pairs fail | Medium | Origin fallback per viewer; optional coturn later |
| P2P adds rebuffering | High | Hard deadlines, immediate origin fallback, release gate |
| Hash poisoning / free riders | Medium | Signed manifests, quarantine, tit-for-tat |
| Safari/iOS no P2P | Medium | Native HLS, explicit "Origin only" state |
| No auth abuse | Medium | Rate limits, signed cookies, hashed IPs, Turnstile optional |
| Tunnel request bursts | Medium | Parts fetched by peers, not all viewers |
| Guest loses host key | Low | Host key restore field; ephemeral streams |
| Recording fills disk | Medium | 7-day retention, size caps, cleanup worker |
| Windows service fragility | Medium | NSSM + restart policy + `start-all.ps1` + health page |

---

## 15. Cost

| Item | Cost |
|---|---|
| Hosting | $0 (existing device) |
| Cloudflare Quick Tunnel | $0 |
| STUN (Google) | $0 |
| Domain (optional, stable link) | ~$10–12/year |
| TURN (optional, later) | free tiers or a small VPS |
| Recording storage | local disk (~1.1 GB/hour) |

The only realistic upgrade is a $5–10/month VPS or a domain. The code should stay portable: Docker Compose for media/api/signal, SQLite file backup, no cloud-specific dependencies.

---

## 16. Defaults chosen (change anytime)

- **Domain:** none for v1; accept the rotating tunnel URL. Add a domain only if stability matters more than $0.
- **Chat:** included, text only, no emotes.
- **Recordings:** on, 7-day retention, host-key scoped.
- **TURN:** off; origin-only fallback for blocked peers.
- **480p rendition:** no; revisit after beta CPU/upstream data.
- **Stream length:** soft cap 4 hours; explicit warning at 3.5.
- **Beta size:** 20 concurrent viewers, 5 creators.

---

## 17. First ten tasks

1. Scaffold the monorepo, tokens, Storybook, and app shell.
2. Implement guest cookie + display name modal + SQLite schema.
3. Write Caddyfile and MediaMTX config; boot the local stack.
4. Spike WHIP publish from Chrome to MediaMTX at 720p.
5. Build the HLS edge proxy with token checks and byte counting.
6. Build the hls.js player with LL-HLS and the studio share link.
7. Add stream create/start/stop + host-key enforcement.
8. Build the signal WebSocket skeleton and SDP/ICE relay.
9. Implement the part scheduler, data channels, and P2P loader.
10. Build the viewer swarm panel and the explainer hero scene.

---

*This document is the source of truth for v1. Update it as decisions change; do not let it drift from the build.*
