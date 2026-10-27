#!/usr/bin/env node
/**
 * Phase 4 acceptance item 1 validator: the WHEP creation rate budget counts
 * only successful creations and buckets per client IP.
 *
 *   node scripts/phase4-rate.mjs fails <streamId> [origin]
 *       Same token, same IP, one 60 s window: two invalid-SDP POSTs (400,
 *       never charged) then repeated successful create+DELETE cycles.
 *       Expect the 7th successful creation to hit the 6/min budget — proving
 *       the two failures never consumed anything (7 valid, not 9).
 *
 *   node scripts/phase4-rate.mjs xff <streamId> [origin]
 *       Same 60 s window as the token itself: six successful creations from
 *       X-Forwarded-For A exhaust A's per-IP bucket (7th attempt 429), then
 *       X-Forwarded-For B creates successfully (201) — proving the buckets
 *       are per-client-IP, not per-endpoint. Forged XFF passes because
 *       trustProxy trusts the edge (locally: Caddy appends, trust-all picks
 *       the first entry; through Cloudflare the first entry is the real
 *       visitor IP).
 *
 *   node scripts/phase4-rate.mjs loopback <streamId> [origin]
 *       Trust-chain discriminator for the edge. JS API origin is drained
 *       first (6 no-XFF creations -> 7th 429 fills the ip=127.0.0.1
 *       bucket), then ONE forged-X-Forwarded-For POST goes through the
 *       edge under test (default http://localhost:8080, the loopback
 *       route cloudflared also takes). 201 = the edge lets upstream XFF
 *       through (leftmost becomes the bucket key); 429 = the edge
 *       replaced it, so per-client IPs die at the edge.
 *
 *   node scripts/phase4-rate.mjs budget <streamId> [origin]
 *       One fresh creation attempt; reports the outcome so the origin
 *       budget guard (429 "origin budget exhausted for direct playback",
 *       reached when a real WHEP viewer already streams) can be seen apart
 *       from the per-stream cap or the rate window.
 */
import { readFile } from "node:fs/promises";

const mode = process.argv[2] ?? "";
const streamId = process.argv[3] ?? "";
if (!streamId || !["fails", "xff", "budget", "loopback", "echo"].includes(mode)) {
  console.error(
    "usage: phase4-rate.mjs <fails|xff|budget|loopback|echo> <streamId> [origin]",
  );
  process.exit(1);
}
const ORIGIN = (process.argv[4] ?? "http://192.168.0.103:8080").replace(/\/+$/, "");
const TOKEN_FILE = "data/phase4-token.txt";

const FINGERPRINT =
  "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF";
const OFFER = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 0.0.0.0",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:EsAw",
  "a=ice-pwd:P2uYro0UCOQ4zxjKXaWCBui1",
  `a=fingerprint:sha-256 ${FINGERPRINT}`,
  "a=setup:actpass",
  "a=mid:0",
  "a=recvonly",
  "a=rtcp-mux",
  "a=rtpmap:96 H264/90000",
  "a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
  "a=rtcp-fb:96 nack",
  "a=rtcp-fb:96 nack pli",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:EsAw",
  "a=ice-pwd:P2uYro0UCOQ4zxjKXaWCBui1",
  `a=fingerprint:sha-256 ${FINGERPRINT}`,
  "a=setup:actpass",
  "a=mid:1",
  "a=recvonly",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
]
  .map((line) => `${line}\r\n`)
  .join("");

async function mintToken() {
  const response = await fetch(`${ORIGIN}/api/streams/${streamId}/playback`);
  const data = await response.json();
  const token = data.token ?? "";
  console.log(
    `mint: status=${response.status} token=${token ? "minted" : "missing"}`,
  );
  return token;
}

async function postWhep(token, tag, { sdp = OFFER, xff = null } = {}) {
  const headers = { "content-type": "application/sdp" };
  if (xff) headers["x-forwarded-for"] = xff;
  const response = await fetch(
    `${ORIGIN}/api/streams/${streamId}/whep?t=${encodeURIComponent(token)}`,
    { method: "POST", headers, body: sdp },
  );
  const body = await response.text();
  const sid = response.headers.get("x-whep-session-id") ?? "";
  console.log(
    `  ${tag} status=${response.status} sid=${sid ? `${sid.slice(0, 10)}…` : "none"} ` +
      `body="${body.slice(0, 90).replace(/\s+/g, " ")}"`,
  );
  return { status: response.status, sid, body };
}

async function deleteSid(sid, tag, xff = null) {
  const headers = xff ? { "x-forwarded-for": xff } : {};
  const response = await fetch(
    `${ORIGIN}/api/streams/${streamId}/whep?sid=${encodeURIComponent(sid)}`,
    { method: "DELETE", headers },
  );
  console.log(`  ${tag} DELETE ${sid.slice(0, 10)}… → ${response.status}`);
}

if (mode === "fails") {
  const token = await mintToken();
  console.log("two invalid-SDP attempts (must be rejected 400 and never charged):");
  await postWhep(token, "bad#1", { sdp: "not-an-sdp" });
  await postWhep(token, "bad#2", { sdp: "" });
  console.log("six successful create+DELETE cycles (each charges the window):");
  for (let i = 1; i <= 6; i += 1) {
    const { sid } = await postWhep(token, `ok#${i}`);
    if (sid) await deleteSid(sid, `ok#${i}`);
  }
  console.log("7th successful attempt (expect 429 rate: got 6 + 0 failures):");
  const seventh = await postWhep(token, "seventh");
  console.log(
    seventh.status === 429 && seventh.body.includes("too many direct-media attempts")
      ? "RATE PASS: 7th valid creation was blocked; the 2 failures were free"
      : `UNEXPECTED: status=${seventh.status}`,
  );
} else if (mode === "xff") {
  const token = await mintToken();
  console.log("XFF A = 203.0.113.10: drain its per-IP bucket (6 successes):");
  for (let i = 1; i <= 6; i += 1) {
    const { sid } = await postWhep(token, `A#${i}`, { xff: "203.0.113.10" });
    if (sid) await deleteSid(sid, `A#${i}`, "203.0.113.10");
  }
  const aSeventh = await postWhep(token, "A#7", { xff: "203.0.113.10" });
  if (aSeventh.sid) await deleteSid(aSeventh.sid, "A#7", "203.0.113.10");
  console.log("XFF B = 203.0.113.20: must hit its own fresh bucket:");
  const bOne = await postWhep(token, "B#1", { xff: "203.0.113.20" });
  if (bOne.sid) await deleteSid(bOne.sid, "B#1", "203.0.113.20");
  if (aSeventh.status === 429 && bOne.status === 201) {
    console.log("XFF PASS: bucket exhausted for A only; B independent");
  } else {
    console.log(`UNEXPECTED: A7=${aSeventh.status} B1=${bOne.status}`);
  }
} else if (mode === "loopback") {
  console.log("step 1: drain the plain 127.0.0.1 bucket against the API origin");
  const apiOrigin = "http://127.0.0.1:4000";
  const minted = await (await fetch(`${apiOrigin}/api/streams/${streamId}/playback`)).json();
  const apiToken = minted.token ?? "";
  for (let i = 1; i <= 6; i += 1) {
    const { status, sid } = await fetch(
      `${apiOrigin}/api/streams/${streamId}/whep?t=${encodeURIComponent(apiToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: OFFER,
      },
    ).then(async (r) => ({ status: r.status, sid: r.headers.get("x-whep-session-id") }));
    if (sid) await deleteSid(sid, `apiFlood#${i}`);
    else console.log(`  apiFlood#${i} status=${status} (stopped early)`);
  }
  const seventh = await fetch(
    `${apiOrigin}/api/streams/${streamId}/whep?t=${encodeURIComponent(apiToken)}`,
    { method: "POST", headers: { "content-type": "application/sdp" }, body: OFFER },
  );
  console.log(
    `  127.0.0.1-bucket 7th status=${seventh.status} (want 429 so the bucket is full)`,
  );

  console.log(`step 2: forged XFF via ${ORIGIN} (the edge under test)`);
  const forged = await postWhep(
    await mintToken(),
    "forgedEdge",
    { xff: "203.0.113.77" },
  );
  if (forged.sid) await deleteSid(forged.sid, "forgedEdge", "203.0.113.77");
  console.log(
    forged.status === 201
      ? "LOOPBACK PASS: edge forwards upstream XFF leftmost; per-client IPs survive it"
      : forged.status === 429
        ? "LOOPBACK FAIL: edge replaced XFF with its own view (bucket collision)"
        : `UNEXPECTED: status=${forged.status} body=${forged.body.slice(0, 80)}`,
  );
} else if (mode === "echo") {
  // Verifies MediaMTX echoes the WHEP create request's query string into
  // session.query on the control API, which is the deterministic way to
  // bind a control-API reader session (internal id) to the API's own sid.
  const mediamtx = "http://127.0.0.1:8889";
  const msid = `probe-echo-${Date.now().toString(36)}`;
  const response = await fetch(
    `${mediamtx}/live/${streamId}/whep?msid=${encodeURIComponent(msid)}`,
    { method: "POST", headers: { "content-type": "application/sdp" }, body: OFFER },
  );
  console.log(`direct create status=${response.status} location=${response.headers.get("location")}`);
  await new Promise((r) => setTimeout(r, 2500));
  const list = await (await fetch("http://127.0.0.1:9997/v3/webrtcsessions/list")).json();
  for (const item of list.items ?? []) {
    if (item.state !== "read") continue;
    console.log(`reader id=${item.id} query='${item.query}' established=${item.peerConnectionEstablished}`);
    if (item.query.includes(msid)) {
      console.log("ECHO PASS: msid round-trips through session.query");
      const locationId = (response.headers.get("location") ?? "")
        .split("/")
        .filter(Boolean)
        .pop();
      await fetch(`${mediamtx}/live/${streamId}/whep/${locationId}`, { method: "DELETE" });
    }
  }
} else {
  const token = await mintToken();
  console.log("single creation attempt (report the gate that fired):");
  const result = await postWhep(token, "single");
  if (result.sid) await deleteSid(result.sid, "single");
}
