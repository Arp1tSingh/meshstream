#!/usr/bin/env node
/**
 * Temporary Phase 4 capability prover: concurrency cap, teardown release and
 * the non-live rejection, each as an isolated mode so the 6/min direct-media
 * rate bucket is never exhausted by one invocation.
 *
 *   node scripts/phase4-cap.mjs burst <streamId> [origin]
 *       mints a playback token (saved to data/phase4-token.txt) then fires
 *       4 POSTs: under WHEP_MAX_SESSIONS=3 expect 201+sid x3 then a cap 429
 *       {"error":"direct WebRTC viewer cap reached for this stream"} — the
 *       caps distinct message. DELETEs every captured session; DELETE is not
 *       rate limited and each response shows the accounting count falling.
 *
 *   node scripts/phase4-cap.mjs recreate <streamId> [origin]
 *       reuses the saved token: 3 more POSTs. Run >= 62 s after any earlier
 *       burst so the fresh bucket proves teardown freed the cap (and the
 *       201s prove the gate still admits viewers afterwards).
 *
 *   node scripts/phase4-cap.mjs notlive <streamId> [origin]
 *       POSTs against the SAME saved token after the stream has ended:
 *       expect 409 {"error":"stream is not live"}.
 */
import { readFile, writeFile } from "node:fs/promises";

const mode = process.argv[2] ?? "";
const streamId = process.argv[3] ?? "";
if (!streamId || !["burst", "recreate", "notlive"].includes(mode)) {
  console.error("usage: phase4-cap.mjs <burst|recreate|notlive> <streamId> [origin]");
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

const sessions = [];

async function postWhep(token, tag) {
  const response = await fetch(
    `${ORIGIN}/api/streams/${streamId}/whep${token ? `?t=${encodeURIComponent(token)}` : ""}`,
    { method: "POST", headers: { "content-type": "application/sdp" }, body: OFFER },
  );
  const body = await response.text();
  const sid = response.headers.get("x-whep-session-id") ?? "";
  if (sid) sessions.push(sid);
  const summary = sid
    ? `status=${response.status} sid=${sid.slice(0, 12)}… sdpAnswer=${body.includes("v=0")}`
    : `status=${response.status} body="${body.slice(0, 130).replace(/\s+/g, " ")}"`;
  console.log(`  ${tag} ${summary}`);
  if (body.includes("too many direct-media attempts")) {
    console.log(`  ${tag} RATE-HIT: aborting remaining POSTs of this phase`);
    return null;
  }
  return { response, status: response.status, sid };
}

async function teardown(tag) {
  for (const sid of sessions) {
    const response = await fetch(
      `${ORIGIN}/api/streams/${streamId}/whep?sid=${encodeURIComponent(sid)}`,
      { method: "DELETE" },
    );
    console.log(`  ${tag} DELETE ${sid.slice(0, 12)}… → ${response.status} ${await response.text()}`);
  }
  sessions.length = 0;
}

if (mode === "burst") {
  console.log("mint token via /playback");
  const playback = await fetch(`${ORIGIN}/api/streams/${streamId}/playback`);
  const data = await playback.json();
  const token = data.token ?? "";
  console.log(`  status=${playback.status} whepPath=${data.whepPath} token=${token ? "minted" : "missing"}`);
  if (!token) process.exit(1);
  await writeFile(TOKEN_FILE, token, "utf8");
  console.log(`  saved -> ${TOKEN_FILE}`);

  console.log("burst: expect 201,201,201 then the cap 429 (WHEP_MAX_SESSIONS=3)");
  for (let i = 1; i <= 4; i += 1) {
    const result = await postWhep(token, `POST#${i}`);
    if (!result) break;
  }
  console.log("teardown: cap must release (accounted sessions fall to 0)");
  await teardown("burst");
  console.log("burst done");
} else if (mode === "recreate") {
  const token = (await readFile(TOKEN_FILE, "utf8")).trim();
  console.log(`recreate with saved token (fresh 60 s bucket expected): 3x 201`);
  for (let i = 1; i <= 3; i += 1) {
    const result = await postWhep(token, `POST#${i}`);
    if (!result) break;
  }
  console.log("teardown again");
  await teardown("recreate");
  console.log("recreate done");
} else {
  const token = (await readFile(TOKEN_FILE, "utf8")).trim();
  const response = await fetch(
    `${ORIGIN}/api/streams/${streamId}/whep?t=${encodeURIComponent(token)}`,
    { method: "POST", headers: { "content-type": "application/sdp" }, body: OFFER },
  );
  const body = (await response.text()).replace(/\s+/g, " ");
  const pass = response.status === 409 && body.includes("stream is not live");
  console.log(
    `notlive: status=${response.status} body="${body}" -> ${pass ? "PASS" : "UNEXPECTED"}`,
  );
  process.exit(pass ? 0 : 2);
}
