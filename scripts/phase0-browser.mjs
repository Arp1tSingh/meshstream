#!/usr/bin/env node
/**
 * Phase-0 automated publish baseline (Microsoft Edge + real camera or screen).
 *
 * What it does:
 *   1. mints a MeshStream room through the API (guest cookie handled here)
 *   2. launches an isolated Edge profile over the LAN-origin studio with
 *      `?debug=stats&sim=cam|screen` so the in-app debug path auto-publishes
 *   3. captures `[encode]` / `[player]` / `[sdp:*]` console output and the API
 *      stream-state polling into a log file under data/
 *
 * Usage:
 *   node scripts/phase0-browser.mjs --mode cam     --duration 120
 *   node scripts/phase0-browser.mjs --mode screen  --duration 120
 *   node scripts/phase0-browser.mjs --origin http://192.168.0.103:8080 ...
 */

import { mkdir, rm, writeFile, appendFile } from "node:fs/promises";
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

/** Public origin for the run — LAN IP keeps WebRTC media off loopback so that
 *  UDP-level impairments (Clumsy) can actually see the publisher traffic. */
const origin = (args.origin ?? "http://localhost:8080").replace(/\/+$/, "");
const mode = args.mode ?? "cam";
const duration = Number(args.duration ?? 90);
const cdpPort = Number(args.cdpPort ?? 9333);
const logDir = path.resolve("data");
const profileDir = path.join(
  path.resolve(".tools"),
  "phase0-profiles",
  `${new URL(origin).hostname.replace(/[^a-z0-9]/gi, "_")}-${mode}`,
);
const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
const logPath = path.join(logDir, `phase0-${mode}-${stamp}.log`);

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
    title: `Phase0 ${mode} baseline ${stamp}`,
    category: "Just Chatting",
  }),
});
if (!create.ok) {
  console.error(`stream create failed: ${create.status} ${await create.text()}`);
  process.exit(1);
}
const { stream, hostKey } = await create.json();
await log(`stream=${stream.id} mode=${mode} origin=${origin}`);
await log(`host_key_guarded=yes host_start=${stream.state}`);

// ---------------------------------------------------------------------------
// Launch Edge headful with the automation flags.
// ---------------------------------------------------------------------------
const pageUrl = `${origin}/studio/${stream.id}?debug=stats&sim=${mode}`;
const edgeFlags = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  pageUrl,
];
// cam mode intentionally uses the REAL camera: no fake-device flag. The
// --use-fake-ui flag above only auto-grants permission, it does not substitute
// a synthetic capture device.
if (mode === "screen")
  edgeFlags.splice(
    edgeFlags.length - 1,
    0,
    "--auto-select-desktop-capture-source=Entire screen",
  );
// getUserMedia needs a secure context; only localhost qualifies over HTTP, so
// grant it to the LAN origin for the impairment runs (automation-only flag —
// it never touches the shipped app or other browsers).
if (!origin.includes("//localhost") && !origin.includes("//127.0.0.1"))
  edgeFlags.splice(
    edgeFlags.length - 1,
    0,
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
  );

let edge;
if (args.edge) {
  edge = spawn(args.edge, edgeFlags, { stdio: "ignore" });
} else {
  edge = spawn(EDGE, edgeFlags, { stdio: "ignore" });
}
await log(`edge_pid=${edge.pid} flags="${edgeFlags.slice(0, -1).join(" ")}"`);

// ---------------------------------------------------------------------------
// CDP session against the page target
// ---------------------------------------------------------------------------
let wsUrl = null;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !wsUrl) {
  try {
    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = await list.json();
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
await log(`ws_url_reached=yes url=${pageUrl}`);

const cdp = new WebSocket(wsUrl, { maxPayload: 128 * 1024 * 1024 });
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });

cdp.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  }
});

const interesting = (message) => {
  if (message.method === "Runtime.consoleAPICalled") {
    const { type, args: cargs } = message.params ?? {};
    const text = (cargs ?? [])
      .map((a) => a.value ?? (a.description ? a.description : ""))
      .filter((v) => v !== "")
      .join(" ");
    return `[console.${type}] ${text}`;
  }
  if (message.method === "Log.entryAdded") {
    const entry = message.params ?? {};
    return `[browser.${entry.source ?? "?"}] ${entry.text ?? ""}`;
  }
  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params?.exceptionDetails?.exception?.description ?? "";
    return `[exception] ${detail}`;
  }
  return null;
};

await new Promise((resolve, reject) => {
  cdp.on("open", resolve);
  cdp.on("error", reject);
});
cdp.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const line = interesting(message);
  if (line) void log(line);
});

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");

// Preload the host key then reload so the studio gate unlocks on this origin.
const hostRecord = { streamId: stream.id, hostKey, title: stream.title, createdAt: Date.now() };
const navigate = await send("Page.navigate", { url: pageUrl });
await log(`navigate=${JSON.stringify(navigate)}`);
await new Promise((r) => setTimeout(r, 2500));
await send("Runtime.evaluate", {
  expression: `localStorage.setItem('meshstream:hosts', JSON.stringify([${JSON.stringify(
    hostRecord,
  )}])); localStorage.removeItem('meshstream:p2p');`,
  awaitPromise: true,
});
await send("Page.reload", { ignoreCache: true });
await log("host_key_seeded=yes reload=yes");

// ---------------------------------------------------------------------------
// Run window
// ---------------------------------------------------------------------------
const started = Date.now();
let publishSeen = false;
let status = "running";
const reporter = setInterval(() => {
  const elapsed = Math.round((Date.now() - started) / 1000);
  void (async () => {
    try {
      const res = await api(`/api/streams/${stream.id}`);
      const summary = await res.json();
      await log(
        `[api t=${elapsed}s] state=${summary.state} viewers=${summary.viewerCount ?? "?"}`,
      );
    } catch {
      await log(`[api t=${elapsed}s] state info unavailable`);
    }
  })();
}, 10000);
cdp.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (
    message.method === "Runtime.consoleAPICalled" &&
    JSON.stringify(message.params?.args ?? []).includes("[encode]")
  ) {
    publishSeen = true;
  }
  if (
    message.method === "Runtime.consoleAPICalled" &&
    (JSON.stringify(message.params?.args ?? []).includes("publish") ||
      JSON.stringify(message.params?.args ?? []).includes("sim"))
  ) {
    status = "publishing";
  }
});
while (Date.now() - started < duration * 1000) {
  await new Promise((r) => setTimeout(r, 500));
}
clearInterval(reporter);
await log(`run_done status=${status} publish_seen=${publishSeen}`);

// Clean shutdown: stop the stream via the API, then close the browser.
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
  await send("Browser.close");
} catch {
  edge.kill();
}
await new Promise((r) => setTimeout(r, 1200));
try {
  edge.kill();
} catch {}
await log(`browser_closed mode=${mode}`);
process.exit(0);
