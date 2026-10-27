#!/usr/bin/env node
/**
 * Publisher-side encoder bench, isolated from MediaMTX:
 * in-page RTCPeerConnection -> RTCPeerConnection loopback at the same
 * constraints the studio uses (H.264 preference, maxBitrate 2.5 Mbps).
 *
 * Sources:
 *   --source fake   Edge fake-device camera (default, controlled low motion)
 *   --source motion animated canvas (high motion)
 *   --source still  mostly-static canvas (local-motion floor)
 *
 * Any bitrate ceiling visible here is a property of the encode path, not of the
 * origin. `[loopbench]` console lines are captured via CDP.
 *
 * Usage: node scripts/phase0-loopbench.mjs [--source motion] [--duration 30]
 */

import { spawn } from "node:child_process";
import { mkdir, rm, appendFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i]?.replace(/^--/, "")] = process.argv[i + 1];
}
const source = args.source ?? "fake";
const duration = Number(args.duration ?? 30);
const cdpPort = Number(args.cdpPort ?? 9334);
const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
const logPath = path.resolve("data", `phase0-loopbench-${source}-${stamp}.log`);
await mkdir(path.dirname(logPath), { recursive: true });

const log = async (line) => {
  await appendFile(logPath, `${line}\n`, "utf8");
  console.log(line);
};

const profile = path.join(path.resolve(".tools"), "phase0-profiles", `loopbench-${stamp}`);
await rm(profile, { recursive: true, force: true });

const edge = spawn(
  EDGE,
  [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let wsUrl = null;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !wsUrl) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await new Promise((r) => setTimeout(r, 300));
}
if (!wsUrl) {
  console.error("no CDP target");
  edge.kill();
  process.exit(1);
}

const cdp = new WebSocket(wsUrl, { maxPayload: 32 * 1024 * 1024 });
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (message) =>
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result),
    );
    cdp.send(JSON.stringify({ id, method, params }));
  });

cdp.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = (message.params?.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? ""))
      .join(" ")
      .trim();
    if (text) void log(`[console.${message.params.type}] ${text}`);
  } else if (message.method === "Runtime.exceptionThrown") {
    void log(`[exception] ${message.params?.exceptionDetails?.exception?.description ?? "?"}`);
  }
});

await new Promise((resolve, reject) => {
  cdp.on("open", resolve);
  cdp.on("error", reject);
});
await send("Runtime.enable");
await send("Page.enable");
await log(`bench_start source=${source} duration=${duration}`);
// getUserMedia requires a secure context; use the local app origin.
await send("Page.navigate", { url: "http://localhost:8080/" });
await new Promise((resolve) => setTimeout(resolve, 2500));

const bench = `(async () => {
  const sourceMode = "${source}";
  let stopped = false;
  let videoTrack;
  if (sourceMode === "fake") {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      audio: true,
    });
    videoTrack = stream.getVideoTracks()[0];
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const boxes = Array.from({ length: 24 }, () => ({
      x: Math.random() * 1230,
      y: Math.random() * 670,
      dx: (Math.random() - 0.5) * 30,
      dy: (Math.random() - 0.5) * 30,
      hue: Math.random() * 360,
      size: 30 + Math.random() * 60,
    }));
    const draw = () => {
      if (stopped) return;
      if (sourceMode === "motion") {
        ctx.fillStyle = \`hsl(\${(performance.now() / 50) % 360} 65% 10%)\`;
        ctx.fillRect(0, 0, 1280, 720);
        for (const b of boxes) {
          b.x += b.dx;
          b.y += b.dy;
          if (b.x < 0 || b.x > 1230) b.dx *= -1;
          if (b.y < 0 || b.y > 670) b.dy *= -1;
          ctx.fillStyle = \`hsl(\${b.hue} 80% 55%)\`;
          ctx.fillRect(b.x, b.y, b.size, b.size);
        }
      } else {
        ctx.fillStyle = "#20232B";
        ctx.fillRect(0, 0, 1280, 720);
      }
      ctx.font = "bold 64px monospace";
      ctx.fillStyle = "#EDEDED";
      ctx.fillText(new Date().toISOString().slice(11, 22), 20, 96);
      requestAnimationFrame(draw);
    };
    draw();
    await new Promise((resolve) => setTimeout(resolve, 800));
    videoTrack = canvas.captureStream(30).getVideoTracks()[0];
  }
  const pcSend = new RTCPeerConnection({});
  const pcRecv = new RTCPeerConnection({});
  pcSend.onicecandidate = (e) => e.candidate && pcRecv.addIceCandidate(e.candidate).catch(() => {});
  pcRecv.onicecandidate = (e) => e.candidate && pcSend.addIceCandidate(e.candidate).catch(() => {});
  const caps = RTCRtpSender.getCapabilities("video");
  const ordered = [
    ...caps.codecs.filter((c) => /h264/i.test(c.mimeType)),
    ...caps.codecs.filter((c) => !/h264/i.test(c.mimeType)),
  ];
  const transceiver = pcSend.addTransceiver(videoTrack, {
    direction: "sendonly",
    sendEncodings: [{ maxBitrate: 2500000, maxFramerate: 30, scaleResolutionDownBy: 1 }],
  });
  transceiver.setCodecPreferences(ordered);
  pcRecv.addTransceiver("video", { direction: "recvonly" });
  pcRecv.ontrack = (e) => {
    const remote = new MediaStream(e.streams[0] ?? [e.track]);
    const v = document.createElement("video");
    v.muted = true;
    v.srcObject = remote;
    v.play().catch(() => {});
    document.body.appendChild(v);
  };
  const offer = await pcSend.createOffer();
  await pcSend.setLocalDescription(offer);
  await pcRecv.setRemoteDescription(pcSend.localDescription);
  const answer = await pcRecv.createAnswer();
  await pcRecv.setLocalDescription(answer);
  await pcSend.setRemoteDescription(pcRecv.localDescription);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let total = 0;
  let last = 0;
  let lastAt = performance.now();
  const tick = async () => {
    if (stopped) return;
    const report = await pcSend.getStats();
    let outbound = null;
    for (const entry of report.values()) {
      if (entry.type === "outbound-rtp" && entry.kind === "video") {
        total = entry.bytesSent ?? total;
        outbound = {
          fps: entry.framesPerSecond ?? null,
          res: entry.frameWidth ? entry.frameWidth + "x" + entry.frameHeight : null,
          target: entry.targetBitrate ?? null,
          limiter: entry.qualityLimitationReason ?? null,
          enc: entry.encoderImplementation ?? null,
          pli: entry.pliCount ?? null,
          nack: entry.nackCount ?? null,
          retrans: entry.retransmittedPacketsSent ?? null,
        };
      }
      if (entry.type === "candidate-pair" && entry.state === "succeeded" && outbound) {
        outbound.bwe = entry.availableOutgoingBitrate ?? null;
      }
    }
    const now = performance.now();
    const mbps = ((total - last) * 8) / ((now - lastAt) / 1000) / 1e6;
    if (outbound) {
      console.log("[loopbench]", JSON.stringify({
        t: Math.round(now / 100) / 10,
        outMbps: Math.round(mbps * 100) / 100,
        source: sourceMode,
        ...outbound,
      }));
    }
    last = total;
    lastAt = now;
    setTimeout(tick, 2000);
  };
  setTimeout(() => { stopped = true; }, ${duration * 1000});
  tick();
  return "bench-running";
})()`;

await send("Runtime.evaluate", { expression: bench, awaitPromise: true })
  .then((result) => log(`bench_eval=${JSON.stringify(result)}`))
  .catch((cause) => log(`bench_eval_failed=${cause.message}`));

await new Promise((resolve) => setTimeout(resolve, duration * 1000 + 3000));
try {
  await send("Browser.close");
} catch {}
await new Promise((resolve) => setTimeout(resolve, 1200));
try {
  edge.kill();
} catch {}
await log("bench_done");
process.exit(0);
