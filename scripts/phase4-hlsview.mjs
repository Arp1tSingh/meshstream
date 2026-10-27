#!/usr/bin/env node
/**
 * Plain HLS viewer tab against an existing stream — no segment interception,
 * no WHEP involvement. Used to put real HLS proxy egress on the origin meter
 * for budget-guard live-fire runs.
 *
 * Usage:
 *   node scripts/phase4-hlsview.mjs <streamId> [origin] [cdpPort] [duration]
 */
import { appendFile, rm, mkdir } from "node:fs/promises";
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

const [streamId, origin = "http://192.168.0.103:8080", cdpArg, durArg] =
  process.argv.slice(2);
if (!streamId) {
  console.error("usage: phase4-hlsview.mjs <streamId> [origin] [cdpPort] [duration]");
  process.exit(1);
}
const cdpPort = Number(cdpArg ?? 9511);
const duration = Number(durArg ?? 240);
const pageUrl = `${origin}/watch/${streamId}?debug=stats`;
const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
const logPath = path.resolve("data", `phase4-hlsview-${stamp}.log`);

async function log(line) {
  await appendFile(logPath, `${line}\n`, "utf8").catch(() => {});
  console.log(line);
}
const at = () => `[${Math.round((Date.now() - startedAt) / 1000)}s]`;
const startedAt = Date.now();

const profileDir = path.resolve(".tools", "phase0-profiles", `phase4-hlsview-${cdpPort}`);
await mkdir(path.dirname(profileDir), { recursive: true });
await rm(profileDir, { recursive: true, force: true });

const edgeFlags = [
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
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
await log(`${at()} edge_pid=${edge.pid}`);

let wsUrl = null;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !wsUrl) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const page = targets.find((t) => t.type === "page" && t.url.includes("/watch/"));
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

const cdp = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  cdp.on("open", resolve);
  cdp.on("error", reject);
});
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
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const { type, args: cargs } = message.params ?? {};
    const text = (cargs ?? [])
      .map((a) => a.value ?? "")
      .filter((v) => v !== "")
      .join(" ");
    // Track player health without spamming: manifests, errors, and a stats
    // line every ~10 s.
    if (text.includes("[hls]") || text.includes('"t":0.') || /\d+\.\d\d\d/.test(text))
      void log(`${at()} [console.${type}] ${text}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    void log(
      `${at()} [exception] ${message.params?.exceptionDetails?.exception?.description ?? "?"}`,
    );
  }
});

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: pageUrl });
await log(`${at()} navigating`);

await new Promise((r) => setTimeout(r, duration * 1000));
await log(`${at()} duration reached`);
try {
  edge.kill();
} catch {}
await new Promise((r) => setTimeout(r, 800));
process.exit(0);
