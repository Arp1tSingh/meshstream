# MeshStream

Peer-assisted 720p live streaming from a browser, with a dark studio UI and a
free public edge. No accounts, no email, no paid infrastructure.

```
Creator browser ──WHIP──▶ MediaMTX ──LL-HLS──▶ API edge proxy ──▶ viewers
                                                     ▲               │
                                                     └── WebRTC ◀────┘
```

Viewers form a WebRTC tree. Each peer keeps a small verified cache of HLS parts
and can serve its children before falling back to the origin. The origin proxy
meters egress, signs playback URLs, and stores SHA-256 hashes so a corrupted
peer segment is rejected.

## What is in v1

- **720p H.264 + Opus**, Low-Latency HLS with ~400 ms parts and 1 s segments
- **Guest-only identity** — a signed `ms_guest` cookie, no password or email
- **Browser studio** — camera/screen capture, mic meter, WHIP publish, track
  replacement, local recording, room health, chat, command palette
- **Peer-assisted playback** — custom hls.js fragment loader, verified peer
  cache, origin fallback, peer/edge telemetry
- **Animated explainer** at `/how-it-works` with an interactive swarm simulator
- **Single free origin** — Caddy on `:8080`, Cloudflare Quick Tunnel for HTTPS
- **No transcoder** — MediaMTX remuxes the browser's H.264 directly into LL-HLS

## Quick start (development)

Prerequisites: Node.js 24+, a camera/microphone, and PowerShell on Windows.

```powershell
npm install
npm run media:setup     # downloads MediaMTX, Caddy, cloudflared into .tools/
npm run media           # terminal 1: MediaMTX on :8888/:8889
npm run dev             # terminal 2: web :3000, API :4000, signal :4001
```

Open http://localhost:3000, choose **Go live**, allow the camera, and copy the
viewer link. Open the viewer link in two more tabs/windows to form a peer edge.

The app is usable without MediaMTX for browsing, the explainer, the simulator,
settings and guest sessions. Live playback needs the media process.

## Free public URL

```powershell
npm run tunnel          # writes data/tunnel-url.txt while it runs
```

This is a Cloudflare Quick Tunnel pointed at Caddy. The URL is public, gets
HTTPS/WSS, and **rotates every time the tunnel restarts**. No Cloudflare account
is required. For a stable hostname, use a named tunnel with a domain you own.

Use the public URL for the studio so camera access gets a secure origin. The
host publishing path still uses MediaMTX's WebRTC listener on the local machine.
Viewers anywhere can watch over the tunnel; a host on a different network needs
UDP `8189` reachable (or a TURN/ingest relay), which v1 does not set up.

## Production-style single origin

```powershell
npm run build
npm run up              # builds, starts missing services, opens the tunnel
```

`npm run up`:
1. installs the media toolchain if `.tools/` is empty
2. creates `.env` with random secrets if it is missing
3. builds the web app
4. starts MediaMTX, the app stack and Caddy in separate PowerShell windows
5. waits for `http://localhost:8080/api/health`
6. runs the Quick Tunnel in the foreground

`npm run up -- -SkipBuild` reuses the existing production build. Stop the
tunnel with `Ctrl+C`; the other service windows remain open. Restart services
with the same commands or the optional logon tasks below.

| Service | Local port | Public route |
|---|---|---|
| Web (Next.js) | 3000 | `/` (through Caddy) |
| API (Fastify + SQLite) | 4000 | `/api/*`, `/hls/*` |
| Signal (`ws`) | 4001 | `/ws/*` |
| MediaMTX LL-HLS | 8888 (localhost) | proxied by API, never exposed |
| MediaMTX WHIP | 8889 (localhost) | proxied by API, never exposed |
| Caddy | 8080 | local origin, tunnel target |

## Operations

| Command | What it does |
|---|---|
| `npm run dev` | Next, API and signal in watch mode |
| `npm run build` | production web build |
| `npm run typecheck` | TypeScript for API, signal and web |
| `npm run media:setup` | download/update MediaMTX, Caddy, cloudflared |
| `npm run media` / `media:start` | start MediaMTX with `services/mediamtx/mediamtx.yml` |
| `npm run caddy` | start Caddy with `services/caddy/Caddyfile` |
| `npm run tunnel` | start a Quick Tunnel to `http://localhost:8080` |
| `npm run up` | production-style stack + tunnel |
| `npm run services:install` | optional scheduled tasks at Windows logon |
| `npm run services:install -- -Remove` | remove those logon tasks |

`services:install` is optional and runs from the current checkout. The tunnel
task is opt-in (`-IncludeTunnel`) because its URL rotates on restart.

## Environment

No `.env` is required for development. The API falls back to localhost origins
and development secrets. For a shared or public instance, create `.env` (or let
`npm run up` create it) and set:

```ini
COOKIE_SECRET=<32+ random bytes>
PLAYBACK_SECRET=<random secret>
INTERNAL_SECRET=<random secret>
```

Optional overrides are documented in [.env.example](./.env.example). Keep
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SIGNAL_URL` **unset** for the normal
same-origin deployment; the browser automatically uses localhost ports in dev
and the current origin behind Caddy. Setting public URLs into a build makes it
hard to move between localhost and the tunnel.

Runtime data lives in `data/` (SQLite, recordings, tunnel URL/log) and is
gitignored. `.tools/` is also gitignored.

## How host control works

Creating a room returns a random host key. Only a SHA-256 hash is stored by the
API, and the key is saved in the host browser's local storage. Host actions
(start, stop, WHIP proxy, stats, internal chat persistence) require the
`x-host-key` header. The key is never sent to MediaMTX. There is intentionally
no account system in v1.

Playback URLs carry short-lived HMAC tokens. The `/hls/*` proxy validates the
token and stream id, forwards MediaMTX session and blocking-reload query
parameters, and only then fetches media. Peer requests use the same signed URLs
and SHA-256 hashes.

## Verified end-to-end

The following was exercised against the production build, Caddy and a public
Cloudflare Quick Tunnel:

- studio unlock, fake-camera capture, **Go live**, WHIP publish, **On air**
- MediaMTX H.264 track at **1280×720**, LL-HLS master and variant playlists,
  400 ms parts, 200 responses for parts
- three viewer tabs all playing; signal tree reported `3 peers`, `1 edge`,
  `maxDepth 2`
- peer-assisted transfer observed (`21% via peers` in the tunnel run); origin
  fallback continued to work
- host auth rejection (`401`), bad playback token rejection (`403`), chat
  broadcast and persistence, media health probe

Headless browser tests can show inflated stalls in background tabs; foreground
viewer tabs play normally. Peer offload depends on buffered overlap and network
timing, so a small fresh swarm may still be mostly origin-served.

## Troubleshooting

- **Viewer says "Tuning into the live edge"** — check that the stream is live,
  MediaMTX is running (`npm run media`), and `/api/media/health` is reachable.
- **Publish fails** — MediaMTX must be running. The API proxies WHIP; port 8889
  is intentionally not exposed publicly.
- **No camera prompt** — use `http://localhost` or the HTTPS tunnel URL. Plain
  HTTP on a LAN IP is not a secure origin.
- **Tunnel URL stopped working** — Quick Tunnel URLs rotate. Restart
  `npm run tunnel` and use the new `data/tunnel-url.txt`.
- **Windows closes the services** — keep the PowerShell windows open, disable
  sleep, or install the optional logon tasks.

## Layout

```
apps/web             Next.js studio, viewer, explainer, settings
apps/api             Fastify API, SQLite (node:sqlite), HLS proxy, WHIP proxy
apps/signal          WebSocket tree coordinator + chat
packages/protocol    shared domain and wire types
packages/swarm       browser P2P engine
services/            MediaMTX and Caddy configs
scripts/             PowerShell setup/run/tunnel/task scripts
plan.md              full architecture and design notes
```

Built with Next.js 15, Fastify, `ws`, MediaMTX, Caddy, hls.js and WebRTC data
channels. v1 is intentionally one rendition, one origin, and no TURN.
