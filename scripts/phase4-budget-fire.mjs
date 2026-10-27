#!/usr/bin/env node
/**
 * Budget-guard live-fire: one process runs the WHOLE leg with internal
 * timing so harness-to-harness latency cannot drift the observations.
 *
 * Steps (all self-timed):
 *   1. Read the live stream id + host key from data/phase4-host.txt and
 *      wait for state=live.
 *   2. Start a plain HLS viewer (phase4-hlsview.mjs) — real HLS proxy
 *      egress on the origin meter.
 *   3. Start the held watchdog drill (phase4-watchdog.mjs) — its fallback
 *      creates a real metered WHEP session.
 *   4. Poll /stats until whepSessions >= 1, then +25 s for meter deltas.
 *   5. POST one more WHEP create; expect 429 "origin budget exhausted for
 *      direct playback" (the cap is one higher than the live session count,
 *      so the message proves the budget gate, not the cap, fired).
 *   6. Capture /stats (metered whep + HLS + health) and clean up children.
 *
 * Usage:
 *   node scripts/phase4-budget-fire.mjs [cdpPort] [drillPort]
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import WebSocket from "ws"; // keep criterion parity with sibling scripts

const origin = "http://192.168.0.103:8080";
const hlsviewPort = Number(process.argv[2] ?? 9512);
const drillPort = Number(process.argv[3] ?? 9521);
const stamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
const logPath = path.resolve("data", `phase4-budget-fire-${stamp}.log`);

const startedAt = Date.now();
const at = () => `[${Math.round((Date.now() - startedAt) / 1000)}s]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function log(line) {
  console.log(line);
  await import("node:fs/promises")
    .then((m) => m.appendFile(logPath, `${line}\n`, "utf8"))
    .catch(() => {});
}

const hostRow = (await readFile(path.resolve("data", "phase4-host.txt"), "utf8")).split("\t");
const streamId = hostRow[0].trim();
const hostKey = (hostRow[1] ?? "").trim();
if (!streamId || !hostKey) {
  console.error("phase4-host.txt incomplete");
  process.exit(1);
}

const apiBase = "http://127.0.0.1:4000";
async function stats() {
  const res = await fetch(`${apiBase}/api/streams/${streamId}/stats`, {
    headers: { "x-host-key": hostKey },
  });
  return res.json();
}

// 1. Wait for live publish.
await log(`${at()} stream=${streamId} waiting for live...`);
for (let waited = 0; waited < 120_000; waited += 4000) {
  try {
    const res = await (await fetch(`${apiBase}/api/streams/${streamId}`)).json();
    if (res.state === "live") break;
  } catch {
    // api between restarts
  }
  await sleep(4000);
}
const liveCheck = await (await fetch(`${apiBase}/api/streams/${streamId}`)).json();
if (liveCheck.state !== "live") {
  await log(`${at()} stream not live — aborting`);
  process.exit(1);
}
await log(`${at()} live confirmed`);

const children = [];
function runChild(cmd, args) {
  const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"], detached: false });
  children.push(child);
  return child;
}

try {
  // 2. HLS viewer.
  runChild("node", [
    "scripts/phase4-hlsview.mjs",
    streamId,
    origin,
    String(hlsviewPort),
    "300",
  ]);
  await log(`${at()} hlsview started (port ${hlsviewPort})`);

  // Give the HLS viewer ~40 s to pull egress onto the meter.
  await sleep(40_000);
  const preDrill = await stats();
  await log(
    `${at()} pre-drill stats: originMbps=${preDrill.originMbps} whepSessions=${preDrill.whepSessions} budget=${preDrill.originBudgetMbps}`,
  );

  // 3. Held watchdog drill.
  runChild("node", [
    "scripts/phase4-watchdog.mjs",
    streamId,
    origin,
    String(drillPort),
    "130",
  ]);
  await log(`${at()} drill started (port ${drillPort})`);

  let sessionUp = false;

  // 4. The previous leg's stale session must drain so session counts stay
  // honest, then the drill's fresh session is ready only once it carries
  // REAL metered bytes (> 1 Mbps) — stale sessions meter zero.
  for (let waited = 0; waited < 120_000; waited += 3000) {
    const s = await stats();
    if (Number(s.whepSessions) === 0) break;
    await sleep(3000);
  }
  await log(`${at()} session table drained`);
  for (let waited = 0; waited < 110_000; waited += 2000) {
    const s = await stats();
    if (Number(s.whepMbps) >= 1) {
      sessionUp = true;
      break;
    }
    await sleep(2000);
  }
  if (!sessionUp) {
    await log(`${at()} fallback session never appeared — aborting`);
    process.exit(1);
  }
  await log(`${at()} whep session live; letting the meter feed 25 s`);
  await sleep(25_000);

  const feeding = await stats();
  await log(
    `${at()} pre-post stats: originMbps=${feeding.originMbps} whepMbps=${feeding.whepMbps} advisory=${feeding.whepMbpsAdvisory}`,
  );

  // 5. The extra creation should hit the budget gate.
  const tokenRes = await fetch(`${origin.replace(/\/+$/, "")}/api/streams/${streamId}/playback`);
  const token = tokenRes.ok ? ((await tokenRes.json()).token ?? "") : "";
  await log(`${at()} playback token: status=${tokenRes.status} minted=${token ? "yes" : "no"}`);
  const offer = await readFile(path.resolve("data", "phase4-fire-offer.sdp"), "utf8");
  const whepRes = await fetch(
    `${origin.replace(/\/+$/, "")}/api/streams/${streamId}/whep?t=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: offer,
    },
  );
  const body = await whepRes.text();
  await log(`${at()} extra create: status=${whepRes.status} body=${body.slice(0, 220)}`);
  const fired = whepRes.status === 429 && body.includes("origin budget exhausted");
  if (!fired && whepRes.status === 201) {
    // Unexpected success: don't leak the session.
    const sid = whepRes.headers.get("x-whep-session-id") ?? "";
    if (sid) {
      await fetch(`${origin.replace(/\/+$/, "")}/api/streams/${streamId}/whep?sid=${encodeURIComponent(sid)}`, {
        method: "DELETE",
      });
      await log(`${at()} unexpected 201 — cleaned up session ${sid.slice(0, 8)}`);
    }
  }

  // 6. Closing /stats snapshot.
  await sleep(3000);
  const finalStats = await stats();
  await log(
    `${at()} final stats: originMbps=${finalStats.originMbps} whepSessions=${finalStats.whepSessions} whepMbps=${finalStats.whepMbps} advisory=${finalStats.whepMbpsAdvisory} health=${finalStats.health}`,
  );
  await log(`${at()} budget fire ${fired ? "PASS" : "FAIL"}`);
  process.exit(fired ? 0 : 2);
} finally {
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}
