import { getApiBase } from "./api";

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
 */
function preferH264(pc: RTCPeerConnection) {
  if (typeof RTCRtpSender === "undefined" || !RTCRtpSender.getCapabilities) return;
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const h264 = codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/h264");
  if (h264.length === 0) return;
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.sender.track?.kind !== "video") continue;
    try {
      transceiver.setCodecPreferences(h264);
    } catch {
      // Older browsers can reject a narrowed list; keep the default offer.
    }
  }
}

/**
 * Send a browser offer to MediaMTX through the API's WHIP proxy and apply the
 * answer. The host key never reaches MediaMTX; the API checks it first.
 */
export async function publishToWhip({
  pc,
  streamId,
  hostKey,
  timeoutMs = 15_000,
}: {
  pc: RTCPeerConnection;
  streamId: string;
  hostKey: string;
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

    // Keep the origin at the captured resolution. Without this Chromium can
    // downscale to a lower resolution when the WebRTC bandwidth estimate dips.
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      params.degradationPreference = "maintain-resolution";
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
