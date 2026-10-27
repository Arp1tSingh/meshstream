#!/usr/bin/env node
/**
 * Publish-only variant of phase3-viewer.mjs: creates a stream, auto-publishes
 * through the studio page with the simulated camera, stays live until the
 * duration ends, then stops. Preserves the host key on disk so metering
 * probes (/api/streams/:id/stats is host-gated) can run while it streams.
 *
 * The CDP flow mirrors phase3-viewer.mjs exactly (the sequence matters —
 * seed AFTER the studio page has mounted): Runtime/Page/Log enable ->
 * Page.navigate -> wait 2.5 s -> seed meshstream:hosts -> Page.reload.
 *
 * Files written:
 *   data/phase4-publish.log   full run log (console + api lines)
 *   data/phase4-host.txt      "<streamId>\t<hostKey>\t<startMs>"
 *
 * Usage:
 *   node scripts/phase4-publish.mjs [--origin http://192.168.0.103:8080] [--duration 600] [--cdpPort 9355]
 */
import { mkdir, appendFile, rm, writeFile } from "node:fs/promises";
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
const duration = Number(args.duration ?? 600);
const cdpPort = Number(args.cdpPort ?? 9355);
const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
const logPath = path.resolve("data", "phase4-publish.log");

async function log(line) {
  await appendFile(logPath, `${line}\n`, "utf8").catch(() => {});
  console.log(line);
}

const profileDir = path.resolve(".tools", "phase0-profiles", `phase4-publish-${cdpPort}`);
await mkdir(path.dirname(profileDir), { recursive: true });
await rm(profileDir, { recursive: true, force: true });

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
      ...(options.body && !options.headers?.["content-type"]
        ? { "content-type": "application/json" }
        : {}),
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
    title: `Phase4 probe ${stamp}`,
    category: "Technology",
  }),
});
if (!create.ok) {
  console.error(`stream create failed: ${create.status} ${await create.text()}`);
  process.exit(1);
}
const { stream, hostKey } = await create.json();
await writeFile(
  path.resolve("data", "phase4-host.txt"),
  `${stream.id}\t${hostKey}\t${Date.now()}`,
  "utf8",
);
await log(`stream=${stream.id} origin=${origin} hostKey=saved`);

const pageUrl = `${origin}/studio/${stream.id}?debug=stats&sim=cam`;
const edgeFlags = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  // Same flag as phase3-viewer: keep muted background video decoding so the
  // publish pipeline is not frozen by Windows occlusion tracking.
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
const attachDeadline = Date.now() + 20_000;
while (Date.now() < attachDeadline && !wsUrl) {
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
    if (message.method === "Network.responseReceived") {
      const { response } = message.params ?? {};
      const path = response ? new URL(response.url).pathname : "";
      if (/\/(start|publish|stop)$/.test(path) || path.includes("/whip")) {
        return `[net] ${response.status} ${path}`;
      }
      return null;
    }
    if (message.method === "Network.loadingFailed") {
      const { errorText, canceled } = message.params ?? {};
      return `[net] FAIL ${canceled ? "(aborted)" : errorText}`;
    }
    return null;
  };
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const line = decode(message);
    if (line) void log(`${prefix}${line}`);
  });
  return send;
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

// Host key preload + reload so the studio auto-publishes — exactly the
// phase3-viewer order: navigate first, let the studio mount, then seed.
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
  try {
    edge.kill();
  } catch {}
  process.exit(1);
}

// Publishing. Log the API view every 30 s so the run has progress markers.
const startedAt = Date.now();
const reporter = setInterval(() => {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  void (async () => {
    try {
      const res = await api(`/api/streams/${stream.id}`);
      const summary = await res.json();
      await log(
        `[api t=${elapsed}s] state=${summary.state} viewers=${summary.viewerCount}`,
      );
    } catch {
      await log(`[api t=${elapsed}s] state info unavailable`);
    }
  })();
}, 30_000);

await new Promise((r) => setTimeout(r, duration * 1000));
clearInterval(reporter);
await log("publish_done status=complete");

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
  edge.kill();
} catch {}
await new Promise((r) => setTimeout(r, 1200));
await log("browser_closed");
process.exit(0);
