#!/usr/bin/env node
/**
 * Phase-3 delivery verification: one publisher (real camera over the LAN
 * origin) plus N viewer tabs on /watch/<id>.
 *
 * What it records:
 *   - publisher `[encode]` samples (health of the source under the same
 *     conditions as Phase 2)
 *   - each viewer's `[player]` debug samples (level bitrate, hls.js bandwidth
 *     estimate, bytes/s, latency, buffer, live state)
 *   - each viewer's swarm state read straight from the MeshGraph aria-label
 *     ("Local swarm view: N direct peers, X percent peer traffic")
 *   - API stream state + viewerCount
 *
 * Usage:
 *   node scripts/phase3-viewer.mjs --origin http://192.168.0.103:8080 --viewers 2 --duration 60
 */

import { mkdir, rm, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import WebSocket from "ws";

const EDGE =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(EDGE)) {
  console.error(`Edge not found at ${EDGE}`);
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, "");
  const value = process.argv[i + 1];
  if (key) args[key] = value;
}

const origin = (args.origin ?? "http://localhost:8080").replace(/\/+$/, "");
const mode = args.mode ?? "cam";
const duration = Number(args.duration ?? 60);
const viewerCount = Number(args.viewers ?? 2);
/** Later joins wait this long so a viewer-3-style child meets warm parents. */
const joinStagger = Number(args.stagger ?? (viewerCount > 2 ? 8000 : 2500));
const cdpPort = Number(args.cdpPort ?? 9333);
const logDir = path.resolve("data");
const profileDir = path.join(
  path.resolve(".tools"),
  "phase0-profiles",
  `${new URL(origin).hostname.replace(/[^a-z0-9]/gi, "_")}-${mode}-v${viewerCount}`,
);
const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
const logPath = path.join(logDir, `phase3-${stamp}.log`);

async function log(line) {
  await appendFile(logPath, line.endsWith("\n") ? line : `${line}\n`, "utf8");
  console.log(line);
}

await mkdir(logDir, { recursive: true });
await rm(profileDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// API: create a stream, remember any guest cookie handed back
// ---------------------------------------------------------------------------
const apiBase = args.apiBase ?? "http://127.0.0.1:4000";
const cookies = new Map();
function rememberCookies(response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () =>
  [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
async function api(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      ...(options.headers ?? {}),
    },
  });
  rememberCookies(response);
  return response;
}

const create = await api("/api/streams", {
  method: "POST",
  body: JSON.stringify({
    title: `Phase3 delivery ${stamp}`,
    category: "Just Chatting",
  }),
});
if (!create.ok) {
  console.error(`stream create failed: ${create.status} ${await create.text()}`);
  process.exit(1);
}
const { stream, hostKey } = await create.json();
await log(`stream=${stream.id} origin=${origin} viewers=${viewerCount}`);

const pageUrl = `${origin}/studio/${stream.id}?debug=stats&sim=${mode}`;
const edgeFlags = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  // Background viewer tabs must keep playing (and serving) during harness
  // runs; Windows occlusion tracking otherwise freezes muted background video.
  "--disable-features=CalculateNativeWinOcclusion",
  pageUrl,
];
if (!origin.includes("//localhost") && !origin.includes("//127.0.0.1"))
  edgeFlags.splice(
    edgeFlags.length - 1,
    0,
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
  );

const edge = spawn(EDGE, edgeFlags, { stdio: "ignore" });
await log(`edge_pid=${edge.pid}`);

let wsUrl = null;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !wsUrl) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const page = targets.find((t) => t.type === "page" && t.url.includes("/studio"));
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {
    // browser still booting
  }
  if (!wsUrl) await new Promise((r) => setTimeout(r, 300));
}
if (!wsUrl) {
  console.error("could not reach Edge DevTools endpoint");
  edge.kill();
  process.exit(1);
}

/** Page-level CDP client: one WebSocket per tab, console lines prefixed. */
function attachPage(ws, { prefix }) {
  let nextId = 1;
  const pending = new Map();
  /** requestId -> short url tail, for describing network failures compactly */
  const requests = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const decode = (message) => {
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
      return null;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const { type, args: cargs } = message.params ?? {};
      const text = (cargs ?? [])
        .map((a) => a.value ?? (a.description ? a.description : ""))
        .filter((v) => v !== "")
        .join(" ");
      return text ? `[console.${type}] ${text}` : null;
    }
    if (message.method === "Runtime.exceptionThrown") {
      return `[exception] ${message.params?.exceptionDetails?.exception?.description ?? "?"}`;
    }
    if (message.method === "Network.requestWillBeSent") {
      const { request, requestId } = message.params ?? {};
      if (request && /\/hls\/|\/webrtc\//.test(request.url)) {
        requests.set(requestId, request.url.split("/").pop());
      }
      return null;
    }
    if (message.method === "Network.responseReceived") {
      const { response, requestId } = message.params ?? {};
      if (response && requests.has(requestId)) {
        const tail = requests.get(requestId);
        requests.delete(requestId);
        return `[net] ${response.status} ${tail}`;
      }
      return null;
    }
    if (message.method === "Network.loadingFailed") {
      const { requestId, errorText, canceled } = message.params ?? {};
      if (requests.has(requestId)) {
        const tail = requests.get(requestId);
        requests.delete(requestId);
        return `[net] FAIL ${canceled ? "(aborted)" : errorText} ${tail}`;
      }
      return null;
    }
    return null;
  };
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const line = decode(message);
    if (line) void log(`${prefix} ${line}`);
  });
  return send;
}

/** Attach to a page target by CDP target id, waiting for it to appear. */
async function openPageSocket(targetId, prefix) {
  const deadline = Date.now() + 12_000;
  let page = null;
  while (Date.now() < deadline && !page) {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    page = targets.find((t) => t.type === "page" && t.id === targetId) ?? null;
    if (!page) await new Promise((r) => setTimeout(r, 400));
  }
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  const send = attachPage(ws, { prefix });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  await send("Network.enable");
  return { send, ws, targetId };
}

const cdp = new WebSocket(wsUrl, { maxPayload: 128 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  cdp.on("open", resolve);
  cdp.on("error", reject);
});
const publisher = attachPage(cdp, { prefix: "" });
await publisher("Runtime.enable");
await publisher("Page.enable");
await publisher("Log.enable");

// Host key preload + reload so the studio auto-publishes.
const hostRecord = { streamId: stream.id, hostKey, title: stream.title, createdAt: Date.now() };
await publisher("Page.navigate", { url: pageUrl });
await new Promise((r) => setTimeout(r, 2500));
await publisher("Runtime.evaluate", {
  expression: `localStorage.setItem('meshstream:hosts', JSON.stringify([${JSON.stringify(
    hostRecord,
  )}])); localStorage.removeItem('meshstream:p2p');`,
  awaitPromise: true,
});
await publisher("Page.reload", { ignoreCache: true });
await log("host_key_seeded=yes");

// Wait for live publish.
let live = false;
for (let waited = 0; waited < 40_000; waited += 2000) {
  const res = await api(`/api/streams/${stream.id}`);
  const summary = await res.json();
  if (summary.state === "live") {
    live = true;
    await log(`publish_live=yes waitMs=${waited}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!live) {
  await log("publish_live=no aborting");
  await api(`/api/streams/${stream.id}/stop`, {
    method: "POST",
    headers: { "x-host-key": hostKey },
    body: "",
  });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Open viewer tabs, one at a time, spaced so the parent selection is observable
// ---------------------------------------------------------------------------
const viewers = [];
for (let i = 1; i <= viewerCount; i += 1) {
  const created = await publisher("Target.createTarget", {
    url: `${origin}/watch/${stream.id}?debug=stats`,
    background: false,
  });
  const targetId = created?.targetId ?? null;
  if (!targetId) {
    await log(`viewer-${i}_open=no reason=no-target-id`);
    continue;
  }
  const page = await openPageSocket(targetId, `[viewer-${i}]`);
  if (page) {
    viewers.push({ index: i, ...page });
    await log(`viewer-${i}_open=yes target=${targetId.slice(0, 8)}`);
  } else {
    await log(`viewer-${i}_open=no target=${targetId.slice(0, 8)}`);
  }
  // Stagger joins: with 3+ viewers the third child needs a warm parent cache.
  if (i < viewerCount) await new Promise((r) => setTimeout(r, joinStagger));
}

// ---------------------------------------------------------------------------
// Sampling loop
// ---------------------------------------------------------------------------
const probeExpression = `(() => {
  const label = document.querySelector('[aria-label^="Local swarm view"]')?.getAttribute('aria-label') ?? null;
  const video = document.querySelector('video');
  let buffered = null;
  if (video) {
    for (let i = 0; i < video.buffered.length; i += 1) {
      if (video.currentTime >= video.buffered.start(i) - 0.5 && video.currentTime <= video.buffered.end(i) + 0.5) {
        buffered = Math.max(buffered ?? 0, video.buffered.end(i) - video.currentTime);
      }
    }
    buffered = buffered === null ? null : Math.round(buffered * 10) / 10;
  }
  const stuck = (!video || video.readyState === 0)
    ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 140)
    : null;
  return JSON.stringify({
    graph: label,
    ready: video ? video.readyState : null,
    paused: video ? video.paused : null,
    position: video ? Math.round(video.currentTime * 10) / 10 : null,
    buffered,
    stuck,
  });
})()`;

const startedAt = Date.now();
const reporter = setInterval(() => {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  void (async () => {
    try {
      const res = await api(`/api/streams/${stream.id}`);
      const summary = await res.json();
      await log(`[api t=${elapsed}s] state=${summary.state} viewers=${summary.viewerCount ?? "?"} peerCount=${summary.peerCount ?? "?"}`);
    } catch {
      await log(`[api t=${elapsed}s] state info unavailable`);
    }
    for (const viewer of viewers) {
      try {
        const result = await viewer.send("Runtime.evaluate", {
          expression: probeExpression,
          returnByValue: true,
        });
        await log(`[viewer-${viewer.index} probe t=${elapsed}s] ${result.result?.value ?? "n/a"}`);
      } catch {
        await log(`[viewer-${viewer.index} probe t=${elapsed}s] failed`);
      }
    }
  })();
}, 6000);

while (Date.now() - startedAt < duration * 1000) {
  await new Promise((r) => setTimeout(r, 500));
}
clearInterval(reporter);
await log(`run_done status=complete viewers=${viewers.length}`);

try {
  await api(`/api/streams/${stream.id}/stop`, {
    method: "POST",
    headers: { "x-host-key": hostKey },
    body: "",
  });
  await log(`stream_stopped=yes stream=${stream.id}`);
} catch (cause) {
  await log(`stream_stopped=no reason=${cause.message}`);
}
try {
  await publisher("Browser.close");
} catch {
  edge.kill();
}
await new Promise((r) => setTimeout(r, 1200));
try {
  edge.kill();
} catch {}
await log("browser_closed");
process.exit(0);
