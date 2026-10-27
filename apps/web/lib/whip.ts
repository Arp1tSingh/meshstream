import { getApiBase } from "./api";
import { logSdpVideoSection } from "./debugStats";

function waitForIce(pc: RTCPeerConnection, timeoutMs: number) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/**
 * MediaMTX can remux H.264 into LL-HLS but it cannot transcode VP8/VP9.
 * Chromium puts VP8 first by default, so pin the video sender to H.264 before
 * creating the WHIP offer. Without this the origin receives VP8 and the HLS
 * playlist stays empty even though the publish connection is healthy.
 *
 * The rest of the capability list stays (RTX, RED/FEC ordering kept intact) so
 * retransmission codecs survive negotiation — the publisher needs them the
 * moment loss impairment runs see packet loss on UDP 8189.
 */
function preferH264(pc: RTCPeerConnection) {
  if (typeof RTCRtpSender === "undefined" || !RTCRtpSender.getCapabilities) return;
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const h264 = codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264");
  if (h264.length === 0) return;
  const ordered = [
    ...h264,
    ...codecs.filter((codec) => codec.mimeType.toLowerCase() !== "video/h264"),
  ];
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.sender.track?.kind !== "video") continue;
    try {
      transceiver.setCodecPreferences(ordered);
    } catch {
      // Older browsers can reject a reordered list; keep the default offer.
    }
  }
}

/**
 * Attributed as a no-op in this Chromium build (verified twice on hardware
 * encoder with synthetic and real camera content): x-google-start/min-bitrate
 * fmtp hints do not move the encoder anywhere (loopback bench, MediaMTX runs).
 * The honest extra proof for future knobs: motion content reaches ~2.1 Mbps
 * and still content decays to ~0.14 Mbps through the identical path, so
 * bitrate responds to content, not to these fmtp hints.
 */

/**
 * Send a browser offer to MediaMTX through the API's WHIP proxy and apply the
 * answer. The host key never reaches MediaMTX; the API checks it first.
 */
export async function publishToWhip({
  pc,
  streamId,
  hostKey,
  source = "camera",
  timeoutMs = 15_000,
}: {
  pc: RTCPeerConnection;
  streamId: string;
  hostKey: string;
  /** Screen share wants resolution kept; camera content prefers balanced. */
  source?: "camera" | "screen";
  timeoutMs?: number;
}): Promise<void> {
  preferH264(pc);
  const offer = await pc.createOffer({
    offerToReceiveAudio: false,
    offerToReceiveVideo: false,
  });
  await pc.setLocalDescription(offer);
  await waitForIce(pc, 1800);
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error("The browser did not produce a local offer.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiBase()}/api/streams/${streamId}/whip`, {
      method: "POST",
      headers: {
        "content-type": "application/sdp",
        "x-host-key": hostKey,
      },
      body: sdp,
      signal: controller.signal,
      credentials: "include",
    });
    const body = await response.text();
    if (!response.ok) {
      let message = `The media server rejected the publish (${response.status}).`;
      try {
        const parsed = JSON.parse(body) as { error?: string; hint?: string };
        if (parsed.error) message = parsed.hint ? `${parsed.error} — ${parsed.hint}` : parsed.error;
      } catch {
        if (body.trim()) message = body.trim().slice(0, 200);
      }
      throw new Error(message);
    }
    if (!body.trim()) throw new Error("The media server returned an empty answer.");
    await pc.setRemoteDescription({ type: "answer", sdp: body });
    // One-shot per publish: shows the negotiated H.264 profile, RTX presence,
    // transport-cc/REMB, and the fmtp lines Chrome operates from.
    logSdpVideoSection("publisher-answer", body);

    // Screen content keeps resolution first; camera content degrades
    // framerate/resolution in balance under pressure instead of holding a
    // full frame set while the encoder squeezes quality.
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      params.degradationPreference = source === "screen" ? "maintain-resolution" : "balanced";
      try {
        await sender.setParameters(params);
      } catch {
        // Not every browser implements degradationPreference.
      }
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new Error("The media server did not answer in time. Is MediaMTX running?");
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
