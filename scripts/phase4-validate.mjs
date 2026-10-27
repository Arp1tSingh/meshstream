/**
 * Temporary Phase 4 validator: proves the WHEP fallback is API-gated.
 * Usage: node scripts/phase4-validate.mjs <streamId> [origin]
 * Steps: Caddy legacy route dead -> no-token 403 -> token mint -> session
 * create (x-whep-session-id) -> heartbeat report -> concurrency cap ->
 * DELETE teardown -> session recreation after teardown.
 */
const streamId = process.argv[2] ?? "";
const ORIGIN = (process.argv[3] ?? "http://192.168.0.103:8080").replace(/\/+$/, "");
if (!streamId) {
  console.error("streamId required");
  process.exit(1);
}

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

async function step(label, fn) {
  try {
    console.log(`${label}: ${await fn()}`);
  } catch (error) {
    console.log(`${label}: ERROR ${error.message}`);
  }
}

const createdSessions = [];

async function postWhep(token, tag = "") {
  const response = await fetch(
    `${ORIGIN}/api/streams/${streamId}/whep${token ? `?t=${encodeURIComponent(token)}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: OFFER,
    },
  );
  const body = await response.text();
  const sid = response.headers.get("x-whep-session-id") ?? "";
  if (sid) createdSessions.push(sid);
  const summary = sid
    ? `status=${response.status} sid=${sid.slice(0, 14)}… sdpAnswer=${body.includes("v=0")}`
    : `status=${response.status} body="${body.slice(0, 100).replace(/\s+/g, " ")}"`;
  console.log(`  →${tag} ${summary}`);
  return { response, sid, body };
}

await step("1 caddy /webrtc/... removed (expect 404, not SDP)", async () => {
  const response = await fetch(`${ORIGIN}/webrtc/live/${streamId}/whep`, {
    method: "POST",
    headers: { "content-type": "application/sdp" },
    body: OFFER,
  });
  const body = (await response.text()).slice(0, 100).replace(/\s+/g, " ");
  return `status=${response.status} contentType=${response.headers.get("content-type")} body="${body}"`;
});

await step("2 API whep without token (expect 403)", async () => {
  const { response, sid } = await postWhep("");
  return `sid=${sid || "none"} (must be none)`;
});

let token = "";
await step("3 playback handshake (token + whepPath)", async () => {
  const response = await fetch(`${ORIGIN}/api/streams/${streamId}/playback`);
  const data = await response.json();
  token = data.token ?? "";
  return `status=${response.status} whepPath=${data.whepPath} token=${token ? "minted" : "missing"}`;
});

await step("4 whep session with token (expect 201 + sid + SDP)", async () => {
  const { response, sid, body } = await postWhep(token);
  return `sid=${sid ? sid.slice(0, 14) + "…" : "none"} sdpAnswer=${body.includes("v=0")}`;
});

await step("5 report mbps (expect ok:true + sessions)", async () => {
  const sid = createdSessions.at(-1) ?? "none";
  const response = await fetch(`${ORIGIN}/api/streams/${streamId}/whep/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sid, mbps: 2.41 }),
  });
  return `status=${response.status} body=${await response.text()}`;
});

await step("6 concurrency cap (fill 9 more; cap=8)", async () => {
  let created = 0;
  let rejected = 0;
  for (let i = 0; i < 9; i += 1) {
    const response = await fetch(
      `${ORIGIN}/api/streams/${streamId}/whep?t=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "content-type": "application/sdp" }, body: OFFER },
    );
    const sid = response.headers.get("x-whep-session-id") ?? "";
    if (sid) createdSessions.push(sid);
    if (response.status === 201) created += 1;
    else {
      rejected += 1;
      if (rejected === 1) {
        console.log(`  → first reject: status=${response.status} body=${await response.text()}`);
      }
    }
  }
  return `created=${created} rejected=${rejected}`;
});

await step("7 teardown all sessions (expect cleared=all)", async () => {
  let cleared = 0;
  for (const sid of createdSessions) {
    const response = await fetch(
      `${ORIGIN}/api/streams/${streamId}/whep?sid=${encodeURIComponent(sid)}`,
      { method: "DELETE" },
    );
    if (response.ok) cleared += 1;
  }
  const probe = await fetch(`${ORIGIN}/api/streams/${streamId}/whep/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "0000000000000000AAAAAAAA", mbps: 1 }),
  });
  return `cleared=${cleared}/${createdSessions.length} unknownSessionReport=${probe.status} ${await probe.text()}`;
});

await step("8 recreate after teardown (expect 201 again)", async () => {
  const { response, sid, body } = await postWhep(token);
  let del = "";
  if (sid) {
    const done = await fetch(
      `${ORIGIN}/api/streams/${streamId}/whep?sid=${encodeURIComponent(sid)}`,
      { method: "DELETE" },
    );
    del = ` delete=${done.status}`;
  }
  return `status=${response.status} sdpAnswer=${body.includes("v=0")}${del}`;
});
