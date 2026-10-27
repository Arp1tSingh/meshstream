#!/usr/bin/env node
/**
 * Temporary Phase 4 orchestrator for validation run B4. Spawns the standard
 * publish+viewer harness and, anchored to the moment the stream turns live,
 * drives the remaining Phase 4 proofs in order:
 *
 *   t_live+0    harness: publisher + 2 viewers (--duration 210), normal HLS
 *   t_live+15   scripts/phase4-fallback.mjs on its own Edge (9451): HLS is
 *               made to fail -> fatal -> Player WHEP fallback -> reports ->
 *               event-driven teardown (exits ~t_live+75)
 *   t_live+128  scripts/phase4-cap.mjs burst: 201,201,201 -> cap 429 ->
 *               DELETE to zero (fallback session gone by ~t_live+75 and an
 *               extra wait covers the 90 s session TTL edge)
 *   t_live+190  scripts/phase4-cap.mjs recreate: 3x 201 (teardown freed the
 *               cap, fresh 60 s bucket) -> DELETE to zero
 *   after end   scripts/phase4-cap.mjs notlive: saved token -> 409
 */
import { spawn, execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";

const ORIGIN = "http://192.168.0.103:8080";
const startedAt = Date.now();
const log = (...parts) =>
  console.log(`[b4+${Math.round((Date.now() - startedAt) / 1000)}s]`, ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sleepUntil(epochMs) {
  const remaining = epochMs - Date.now();
  if (remaining > 0) await sleep(remaining);
}

function spawnToFile(name, args) {
  const file = path.resolve("data", name);
  const fileFd = openSync(file, "w");
  const child = spawn(process.execPath, args, { stdio: ["ignore", fileFd, fileFd] });
  log(`spawn ${name}: node ${args.join(" ")}`);
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      closeSync(fileFd);
      log(`${name} exited code=${code}`);
      resolve(code);
    });
  });
}

async function newestPhase3Log() {
  const entries = await readdir("data");
  const named = entries
    .filter((f) => f.startsWith("phase3-") && f.endsWith(".log"))
    .sort();
  return named.at(-1) ? path.join("data", named.at(-1)) : null;
}

async function main() {
  const harnessLog = path.resolve("data", "phase4-b4-harness.log");
  const harnessFd = openSync(harnessLog, "w");
  const harness = spawn(
    process.execPath,
    ["scripts/phase3-viewer.mjs", "--origin", ORIGIN, "--viewers", "2", "--duration", "210"],
    { stdio: ["ignore", harnessFd, harnessFd] },
  );
  log(`harness spawned pid=${harness.pid} -> ${path.basename(harnessLog)}`);

  // Wait for stream id + publish_live in the newest phase3 log.
  let streamId = "";
  const waitStart = Date.now();
  while (Date.now() - waitStart < 90_000) {
    await sleep(1_000);
    const file = await newestPhase3Log();
    if (!file) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    const idLine = text.match(/^stream=([0-9a-f]+) /m);
    if (idLine && !streamId) {
      streamId = idLine[1];
      log(`harness stream id=${streamId} (${path.basename(file)})`);
    }
    if (text.includes("publish_live=yes")) break;
  }
  if (!streamId) {
    console.error("orchestrator: no live stream observed, aborting");
    try {
      execSync(`taskkill /PID ${harness.pid} /T /F`, { stdio: "ignore" });
    } catch {}
    process.exit(1);
  }
  const t0 = Date.now();
  log(`anchor t_live established`);

  await sleepUntil(t0 + 15_000);
  await spawnToFile("phase4-b4-fallback.log", [
    "scripts/phase4-fallback.mjs",
    streamId,
    ORIGIN,
    "9451",
    "60",
  ]);

  await sleepUntil(t0 + 128_000);
  await spawnToFile("phase4-b4-burst.log", ["scripts/phase4-cap.mjs", "burst", streamId, ORIGIN]);

  await sleepUntil(t0 + 190_000);
  await spawnToFile("phase4-b4-recreate.log", [
    "scripts/phase4-cap.mjs",
    "recreate",
    streamId,
    ORIGIN,
  ]);

  // Wait for the harness to end the stream, then run the 409 proof.
  let ended = false;
  const endDeadline = Date.now() + 150_000;
  for (;;) {
    await sleep(4_000);
    let text = "";
    try {
      text = await readFile(harnessLog, "utf8");
    } catch {}
    if (/stream_stopped=yes/.test(text)) {
      ended = true;
      break;
    }
    if (Date.now() > endDeadline) {
      log("no stream end observed within the ceiling; finishing anyway");
      break;
    }
  }
  await sleep(3_000);
  if (ended) {
    await spawnToFile("phase4-b4-notlive.log", [
      "scripts/phase4-cap.mjs",
      "notlive",
      streamId,
      ORIGIN,
    ]);
  } else {
    log("skipping notlive test: stream did not observably end");
  }
  log(`run B4 done stream=${streamId}`);
  closeSync(harnessFd);
  process.exit(0);
}

main().catch((error) => {
  console.error(`orchestrator fatal: ${error?.stack ?? error}`);
  process.exit(1);
});
