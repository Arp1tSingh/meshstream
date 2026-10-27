import { env } from "./env";

/**
 * MediaMTX control-API session meter. The control API lives on loopback only
 * and exposes cumulative per-session WebRTC byte counters, so the API can
 * measure the real origin egress of every direct-media viewer instead of
 * trusting the viewer's own getStats() reports (which stay advisory).
 */

/** Real per-session byte sample from the MediaMTX control API. */
export type MediaMeterSink = (
  sid: string,
  bytesSent: number,
  bytesReceived: number,
  at: number,
) => void;

export interface MediaSessionPoller {
  /** True when the last poll reached the control API. */
  reachable: boolean;
  /** Timestamp of the last successful poll. */
  lastOkAt: number;
  /** Human-readable last error, empty while healthy. */
  lastError: string;
  /** Sessions seen in the last successful poll (publish + read). */
  sessionsSeen: number;
  stop(): void;
}

interface PollItem {
  id?: unknown;
  state?: unknown;
  /** Raw query of the request that created the session (MediaMTX echo). */
  query?: unknown;
  bytesSent?: unknown;
  bytesReceived?: unknown;
}

interface PollerState {
  reachable: boolean;
  lastOkAt: number;
  lastError: string;
  sessionsSeen: number;
}

const READ_STATE = "read";

/**
 * Polls /v3/webrtcsessions/list every `intervalMs` and reports the cumulative
 * byte counters of every reader session through `onSample`. Only bytes sent
 * to a viewer matter for the origin budget: ingress is the publisher's WHIP,
 * and HLS egress is metered separately inside the API proxy.
 */
export function startMediaSessionPoller(
  onSample: MediaMeterSink,
  intervalMs = 3000,
): MediaSessionPoller {
  const state: PollerState = {
    reachable: false,
    lastOkAt: 0,
    lastError: "",
    sessionsSeen: 0,
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let inFlight = false;

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(`${env.mediaApiOrigin}/v3/webrtcsessions/list`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = (await response.json()) as { items?: PollItem[] };
      const now = Date.now();
      const items = Array.isArray(data.items) ? data.items : [];
      state.reachable = true;
      state.lastOkAt = now;
      state.lastError = "";
      state.sessionsSeen = items.length;
      for (const item of items) {
        // Reader sessions only: the publisher shares the path but its bytes
        // are inbound and never count against the viewer egress budget.
        if (item.state !== READ_STATE) continue;
        const sent = Number(item.bytesSent);
        const received = Number(item.bytesReceived);
        if (!Number.isFinite(sent) || !Number.isFinite(received)) continue;
        // The control API session id is an internal UUID that never appears
        // in the WHEP URL we minted, so sessions are matched through the
        // `msid` query echo MediaMTX keeps on every reader (session.query).
        const query = typeof item.query === "string" ? item.query : "";
        const sid = new URLSearchParams(query).get("msid") ?? "";
        if (!sid) continue;
        onSample(sid, sent, received, now);
      }
    } catch (error) {
      // Best effort: when the control API is down the API falls back to the
      // advisory client numbers and the budget guard grows conservative.
      state.reachable = false;
      state.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      inFlight = false;
    }
  };

  void poll();
  timer = setInterval(() => void poll(), intervalMs);

  return {
    get reachable() {
      return state.reachable;
    },
    get lastOkAt() {
      return state.lastOkAt;
    },
    get lastError() {
      return state.lastError;
    },
    get sessionsSeen() {
      return state.sessionsSeen;
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
