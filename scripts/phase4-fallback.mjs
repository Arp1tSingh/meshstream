#!/usr/bin/env node
/**
 * Temporary Phase 4 fallback validator (take 4): forces the WHEP path in a
 * real browser by failing every /hls/ request from a fresh viewer tab on its
 * own Edge instance, then watches hls.js give up, the Player switch to direct
 * WebRTC, and the API-driven session lifecycle (create 201 -> reports ->
 * teardown -> session released).
 *
 * Mechanism (validated by take-3's wiring, which ran clean but stalled the
 * page before hls booted): Edge launches on about:blank, Fetch with pattern
 * "*" is armed BEFORE Page.navigate, non-hls requests are continued,
 * paths under /hls/ are failed with ERR_ABORTED; teardown is event-driven
 * (5 s after the session id is seen on the wire); Edge is killed by PID and
 * profile removal is best effort.
 *
 * Take-4 diagnostics for the stalled page: every paused request logged
 * (first 12), contOk/contErr counters on continuation results, Runtime
 * exceptions + all console messages printed, and two DOM probes.
 *
 * Usage:
 *   node scripts/phase4-fallback.mjs <streamId> [origin] [cdpPort] [durationSeconds]
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
const cdpPort = Number(process.argv[4] ?? 9451);
const duration = Number(process.argv[5] ?? 60);
const startedAt = Date.now();
if (!streamId) {
  console.error("streamId required");
  process.exit(1);
}

const log = (...parts) => console.log(`[${elapsed()}]`, ...parts);
function elapsed() {
  return `${Math.round((Date.now() - startedAt) / 1000)}s`;
}

// 1. Dedicated Edge + viewer tab, but NAVIGATED LATER so Fetch can arm first.
const profileDir = path.join(os.tmpdir(), `ms-edge-4b-${Date.now()}`);
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
log(`edge_pid=${edge.pid} (about:blank; navigate after arm) page=${pageUrl}`);

// 2. Wait for ANY page target on the debugging port.
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

// 3. Page-level CDP socket (single client: Fetch works here).
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
  aborted: 0,
  continued: 0,
  contOk: 0,
  contErr: 0,
  reports: 0,
  deletes: 0,
  whepPosts: [],
  consoleLines: 0,
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

on("Fetch.requestPaused", (params) => {
  const url = new URL(params.request.url);
  if (url.pathname.includes("/hls/")) {
    stats.aborted += 1;
    if (stats.aborted <= 6 || stats.aborted % 25 === 0) {
      log(`abort #${stats.aborted}`, url.pathname.slice(-46));
    }
    void send("Fetch.failRequest", {
      requestId: params.requestId,
      errorReason: "Aborted",
    }).catch(() => {});
  } else {
    stats.continued += 1;
    if (stats.continued <= 12) {
      log(
        `cont #${stats.continued}`,
        `${params.request.method} ${url.host}${url.pathname.slice(0, 58)}${url.search.slice(0, 30)}`,
      );
    }
    void send("Fetch.continueRequest", { requestId: params.requestId }).then(
      () => {
        stats.contOk += 1;
      },
      (error) => {
        stats.contErr += 1;
        log(`contErr #${stats.contErr} ${error.message} on ${url.pathname.slice(0, 50)}`);
      },
    );
  }
});

on("Runtime.consoleAPICalled", (params) => {
  stats.consoleLines += 1;
  if (stats.consoleLines > 40) return;
  const text = params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "";
  log(`console(${params.type})`, text.slice(0, 200));
});

on("Runtime.exceptionThrown", (params) => {
  const detail = params.exceptionDetails ?? {};
  const description = detail.exception?.description ?? detail.text ?? "?";
  log(`exception: ${description.slice(0, 300)}`);
});

// DOM probes: is the page actually hydrating and mounting the player?
async function probe(tagWhen) {
  try {
    const result = await send("Runtime.evaluate", {
      expression: `(() => {
        const video = document.querySelector('video');
        return JSON.stringify({
          href: location.href.slice(-60),
          readyState: document.readyState,
          videos: document.querySelectorAll('video').length,
          videoReady: video ? video.readyState : null,
          body: document.body ? document.body.innerText.replace(/\\s+/g,' ').slice(0, 120) : '(no body)',
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
setTimeout(() => void probe("t+20"), 20_000);
setTimeout(() => void probe("t+45"), 45_000);

on("Network.responseReceivedExtraInfo", (params) => {
  const sid = params.headers?.["x-whep-session-id"] ?? null;
  if (sid && !capturedSessionId) {
    capturedSessionId = sid;
    scheduleTeardown();
    log(`extraInfo captured sid=${sid.slice(0, 14)}… (arming teardown)`);
  }
});

on("Network.responseReceived", (params) => {
  const { url, status, headers } = params.response;
  const u = new URL(url);
  if (u.pathname.includes("/whep/report")) {
    stats.reports += 1;
    void send("Network.getResponseBody", { requestId: params.requestId }).then(
      (body) => log(`report#${stats.reports} ${status} ${body.body ?? ""}`),
      () => log(`report#${stats.reports} ${status}`),
    );
  } else if (u.pathname.endsWith("/whep") && !u.pathname.includes("/report")) {
    const sid = headers["x-whep-session-id"] ?? null;
    stats.whepPosts.push({ method: params.type, status, sid: sid ? "captured" : "none" });
    if (sid && !capturedSessionId) {
      capturedSessionId = sid;
      scheduleTeardown();
    }
    log(`whep ${status} sid=${sid ? `${sid.slice(0, 14)}…` : "none"}`);
  } else if (u.pathname.includes("/playback")) {
    log(`playback ${status} ${u.pathname.slice(-40)}`);
  }
});

// 4. Event-driven teardown 5 s after the session id is seen on the wire.
function scheduleTeardown() {
  if (teardownArmed) return;
  teardownArmed = true;
  setTimeout(async () => {
    if (!capturedSessionId) {
      log("teardown skipped: no session id captured");
      return;
    }
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
  }, 5_000);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
log("fetch interception armed (*) -> navigating now");
await send("Page.navigate", { url: pageUrl });
log(`navigated to ${pageUrl}`);

// 5. Finish: report + safe cleanup.
setTimeout(async () => {
  log(
    `fallback test done: aborted=${stats.aborted} continued=${stats.continued} ` +
      `contOk=${stats.contOk} contErr=${stats.contErr} reports=${stats.reports} ` +
      `deletes=${stats.deletes} whepPosts=${JSON.stringify(stats.whepPosts)}`,
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
