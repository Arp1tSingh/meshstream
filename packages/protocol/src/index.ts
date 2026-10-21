export type StreamState = "idle" | "live" | "ended";

export interface Guest {
  id: string;
  displayName: string;
  color: string;
  createdAt: number;
}

export interface StreamSummary {
  id: string;
  title: string;
  category: string;
  state: StreamState;
  hostName: string;
  hostColor: string;
  startedAt: number | null;
  endedAt: number | null;
  viewerCount: number;
  peerCount: number;
}

export interface PlaybackInfo {
  streamId: string;
  hlsPath: string;
  token: string;
  p2p: boolean;
  state: StreamState;
}

export interface ChatMessage {
  id: string;
  streamId: string;
  guestId: string;
  displayName: string;
  color: string;
  body: string;
  createdAt: number;
  role?: "host" | "mod" | "viewer";
}

export interface StreamStats {
  viewers: number;
  peers: number;
  edges: number;
  originMbps: number;
  originBudgetMbps: number;
  health: "A" | "B" | "C" | "D" | "F";
  state: StreamState;
  uptimeSeconds: number;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface PeerAssignment {
  parent: string | null;
  children: string[];
  iceServers: IceServer[];
}

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

export type ServerMessage =
  | { type: "welcome"; peerId: string; streamId: string; iceServers: IceServer[] }
  | { type: "assign"; parent: string | null; children: string[]; iceServers: IceServer[] }
  | { type: "signal"; from: string; payload: SignalPayload }
  | { type: "peer-left"; peerId: string }
  | { type: "stats"; viewers: number; peers: number; edges: number; maxDepth: number }
  | { type: "error"; message: string }
  | { type: "rebalance" };

export type ClientMessage =
  | { type: "signal"; to: string; payload: SignalPayload }
  | { type: "need-parent" }
  | { type: "ping" };

export const DATA_CHANNEL_CONTROL = "ms-control";
export const DATA_CHANNEL_DATA = "ms-data";
export const CHUNK_SIZE = 16 * 1024;
export const MAX_CACHE_ENTRIES = 180;

/** 4 bytes transfer id, 2 bytes chunk index, 2 bytes chunk count, then payload. */
export const BINARY_HEADER_BYTES = 8;

export interface SwarmStats {
  peers: number;
  parent: string | null;
  children: number;
  cacheEntries: number;
  peerBytes: number;
  originBytes: number;
  servedBytes: number;
  status: "connecting" | "connected" | "origin-only" | "offline";
}

export type ChatServerMessage =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "presence"; viewers: number }
  | { type: "error"; message: string };

export const GUEST_COLORS = [
  "#C9F73A",
  "#5B9DFF",
  "#C084FC",
  "#FFB020",
  "#FF8A8E",
  "#3DDC97",
  "#67E8F9",
  "#F0ABFC",
] as const;

export const CATEGORIES = [
  "Just Chatting",
  "Technology",
  "Gaming",
  "Music",
  "Creative",
  "Education",
  "Sports",
  "Other",
] as const;
