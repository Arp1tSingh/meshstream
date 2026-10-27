#!/usr/bin/env node
/**
 * Phase 4 acceptance item 4 validator: the stuck-attach watchdog.
 *
 * Deterministic reproduction of the silent attach stall in a fresh viewer
 * tab: every /hls/*.m3u8 request is SERVED (the manifest parses, playlist
 * reloads keep coming) but every media segment/init fetch is HELD forever
 * by the Fetch interceptor (neither continued nor failed). From hls.js's
 * view the loader simply never resolves: no bytes, and none of the loader
 * timeouts beat the watchdog (they fire at ~20 s; the watchdog intervenes
 * at 12/16 s). With the watchdog we must see: watchdog-retry (one
 * loadSource restart) -> still stalled -> watchdog-fallback -> WHEP create
 * 201 -> video ready -> reports flowing. Without it the tab hangs on
 * "Tuning into the live edge" forever.
 *
 * Usage:
 *   node scripts/phase4-watchdog.mjs <streamId> [origin] [cdpPort] [durationSeconds]
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const EDGE =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(EDGE)) {
  console.error(`Edge not found at ${EDGE}`);
  process.exit(1);
}

const streamId = process.argv[2] ?? "";
const ORIGIN = (process.argv[3] ?? "http://192.168.0.103:8080").replace(/\/+$/, "");
const cdpPort = Number(process.argv[4] ?? 9462);
const duration = Number(process.argv[5] ?? 90);
const startedAt = Date.now();
if (!streamId) {
  console.error("streamId required");
  process.exit(1);
}

const log = (...parts) => console.log(`[${elapsed()}]`, ...parts);
function elapsed() {
  return `${Math.round((Date.now() - startedAt) / 1000)}s`;
}

const profileDir = path.join(os.tmpdir(), `ms-edge-4w-${Date.now()}`);
const pageUrl = `${ORIGIN}/watch/${streamId}?debug=stats`;
const edgeFlags = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=CalculateNativeWinOcclusion",
];
if (!ORIGIN.includes("//localhost") && !ORIGIN.includes("//127.0.0.1")) {
  edgeFlags.push(`--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`);
}
edgeFlags.push("about:blank");
const edge = spawn(EDGE, edgeFlags, { stdio: "ignore" });
log(`edge_pid=${edge.pid} page=${pageUrl}`);

let target = null;
for (let waited = 0; waited < 20_000 && !target; waited += 400) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    target = targets.find((t) => t.type === "page") ?? null;
  } catch {
    // Edge not up yet
  }
  if (!target) await new Promise((r) => setTimeout(r, 400));
}
if (!target) {
  console.error("page target never appeared");
  killEdge(edge);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

let msgId = 0;
const pending = new Map();
const eventHandlers = [];
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}
function on(event, cb) {
  eventHandlers.push({ event, cb });
}

const stats = {
  playlistsServed: 0,
  partsHeld: 0,
  whepPosts: [],
  reports: 0,
  deletes: 0,
  console: [],
};
let capturedSessionId = null;
let teardownArmed = false;

ws.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id !== undefined && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
    return;
  }
  for (const { event, cb } of eventHandlers) {
    if (message.method === event) cb(message.params ?? {});
  }
});

// Serve the playlists, fail the segments: hls.js keeps its manifest view
// (MANIFEST_PARSED + playlist reloads) but never receives a media payload.
on("Fetch.requestPaused", (params) => {
  const url = new URL(params.request.url);
  const isHls = url.pathname.includes("/hls/");
  const isPlaylist = isHls && url.pathname.endsWith(".m3u8");
  if (isPlaylist) {
    stats.playlistsServed += 1;
    void send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
  } else if (isHls) {
    stats.partsHeld += 1;
    if (stats.partsHeld <= 4 || stats.partsHeld % 25 === 0) {
      log(`segment held #${stats.partsHeld}`, url.pathname.slice(-40));
    }
    // No continueRequest, no failRequest: the fetch stays inflight so no
    // hls.js fatal ever fires and the loader never resolves.
  } else {
    void send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
  }
});

on("Runtime.consoleAPICalled", (params) => {
  const text = params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "";
  const matches =
    text.includes("watchdog") ||
    text.includes("whep-session") ||
    text.includes("[hls]") ||
    text.includes("[player]");
  if (matches) {
    stats.console.push(text.slice(0, 160));
    if (stats.console.length <= 16) log(`console(${params.type})`, text.slice(0, 160));
  }
});

on("Network.responseReceived", (params) => {
  const { url, status, headers } = params.response;
  const u = new URL(url);
  if (u.pathname.includes("/whep/report")) {
    stats.reports += 1;
  } else if (u.pathname.endsWith("/whep") && !u.pathname.includes("/report")) {
    const sid = headers["x-whep-session-id"] ?? "";
    stats.whepPosts.push({ status, sid: sid ? "captured" : "header-missing" });
    log(`whep ${status} sid=${sid ? `${sid.slice(0, 14)}…` : "none"}`);
    if (sid && !capturedSessionId) {
      capturedSessionId = sid;
      scheduleTeardown();
    }
  } else if (u.pathname.includes("/playback")) {
    log(`playback ${status}`);
  }
});

async function probe(tagWhen) {
  try {
    const result = await send("Runtime.evaluate", {
      expression: `(() => {
        const video = document.querySelector('video');
        return JSON.stringify({
          videoReady: video ? video.readyState : null,
          paused: video ? video.paused : null,
          position: video ? Math.round(video.currentTime * 10) / 10 : null,
          body: document.body.innerText.replace(/\\s+/g,' ').slice(0, 90),
        });
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    log(`probe[${tagWhen}] ${result.result?.value ?? "n/a"}`);
  } catch (error) {
    log(`probe[${tagWhen}] failed: ${error.message}`);
  }
}
for (const at of [16, 28, 40, 52]) {
  setTimeout(() => void probe(`t+${at}`), at * 1000);
}

function scheduleTeardown() {
  if (teardownArmed) return;
  teardownArmed = true;
  setTimeout(async () => {
    if (!capturedSessionId) return;
    log(`teardown sid=${capturedSessionId.slice(0, 14)}…`);
    try {
      const response = await fetch(
        `${ORIGIN}/api/streams/${streamId}/whep?sid=${encodeURIComponent(capturedSessionId)}`,
        { method: "DELETE" },
      );
      stats.deletes += 1;
      log(`teardown response: ${response.status} ${await response.text()}`);
    } catch (error) {
      log(`teardown error ${error.message}`);
    }
  }, 6_000);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
log("fetch interception armed (playlists pass, segments abort) -> navigating now");
await send("Page.navigate", { url: pageUrl });
log(`navigated to ${pageUrl}`);

setTimeout(async () => {
  log(
    `watchdog test done: playlistsServed=${stats.playlistsServed} partsHeld=${stats.partsHeld} ` +
      `whepPosts=${JSON.stringify(stats.whepPosts)} reports=${stats.reports} deletes=${stats.deletes} ` +
      `consoleWatchdog=${JSON.stringify(stats.console.slice(0, 6))}`,
  );
  try {
    ws.close();
  } catch {}
  killEdge(edge);
  await new Promise((r) => setTimeout(r, 1_500));
  try {
    await rm(profileDir, { recursive: true, force: true });
  } catch {
    log(`profile cleanup skipped (still locked): ${profileDir}`);
  }
  process.exit(0);
}, duration * 1000);

function killEdge(child) {
  try {
    execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {
    try {
      child.kill();
    } catch {}
  }
}
