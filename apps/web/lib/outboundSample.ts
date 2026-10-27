/**
 * Phase-0 encoder diagnostics snapshot taken from RTCPeerConnection.getStats().
 * Recorded per outbound video stream at the studio's 2 s sampling cadence.
 */
export interface VideoOutboundSample {
  /** Measured outbound video bitrate, Mbps over the sample window. */
  bitrateMbps: number | null;
  fps: number | null;
  /** Chrome's target encode bitrate in Mbps (undefined until the ramp settles). */
  targetBitrateMbps: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  encoderImplementation: string | null;
  nackCount: number | null;
  pliCount: number | null;
  retransmittedPacketsSent: number | null;
  qualityLimitationReason: string | null;
  qualityLimitationDurations: Record<string, number> | null;
  /** Aggregate outgoing link capacity estimate from candidate pairs, Mbps. */
  availableOutgoingBitrateMbps: number | null;
  rttSeconds: number | null;
}

export const emptyOutboundSample: VideoOutboundSample = {
  bitrateMbps: null,
  fps: null,
  targetBitrateMbps: null,
  frameWidth: null,
  frameHeight: null,
  encoderImplementation: null,
  nackCount: null,
  pliCount: null,
  retransmittedPacketsSent: null,
  qualityLimitationReason: null,
  qualityLimitationDurations: null,
  availableOutgoingBitrateMbps: null,
  rttSeconds: null,
};
