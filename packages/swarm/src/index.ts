import {
  BINARY_HEADER_BYTES,
  CHUNK_SIZE,
  DATA_CHANNEL_CONTROL,
  DATA_CHANNEL_DATA,
  MAX_CACHE_ENTRIES,
  type IceServer,
  type ServerMessage,
  type SignalPayload,
  type SwarmStats,
} from "@meshstream/protocol";

export interface SwarmPeerInfo {
  id: string;
  direction: "up" | "down";
  connected: boolean;
  lastTransferAt: number | null;
}

export interface SwarmOptions {
  streamId: string;
  guestId: string;
  displayName: string;
  color: string;
  signalUrl: string;
  apiBase: string;
  onStats?: (stats: SwarmStats) => void;
  onPeers?: (peers: SwarmPeerInfo[]) => void;
  onError?: (message: string) => void;
}

interface IncomingTransfer {
  key: string;
  chunks: number;
  size: number;
  parts: Map<number, Uint8Array>;
  early: Uint8Array[];
  received: number;
  lastActivity: number | null;
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PeerConnectionState {
  id: string;
  pc: RTCPeerConnection;
  control: RTCDataChannel | null;
  data: RTCDataChannel | null;
  initiator: boolean;
  direction: "up" | "down";
  remoteSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  haves: Set<string>;
  incoming: Map<number, IncomingTransfer>;
  nextTransferId: number;
  activeServes: number;
  connected: boolean;
  lastTransferAt: number | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

function signalEndpoint(base: string, role: "viewer" | "studio" | "chat") {
  const clean = base.replace(/\/+$/, "");
  if (clean.endsWith("/ws")) return `${clean}/${role}`;
  return `${clean}/ws/${role}`;
}

async function sha256Hex(buffer: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class SwarmClient {
  private options: SwarmOptions;
  private ws: WebSocket | null = null;
  private peerId: string | null = null;
  private parentId: string | null = null;
  private childIds = new Set<string>();
  private iceServers: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  private peers = new Map<string, PeerConnectionState>();
  private cache = new Map<string, ArrayBuffer>();
  private hashes = new Map<string, string>();
  private serving = false;
  private destroyed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manifestTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastEmit = 0;
  private counters = {
    peerBytes: 0,
    originBytes: 0,
    servedBytes: 0,
  };
  private status: SwarmStats["status"] = "connecting";

  constructor(options: SwarmOptions) {
    this.options = options;
  }

  start() {
    this.destroyed = false;
    this.connect();
    this.statsTimer = setInterval(() => this.emit(), 1000);
  }

  private connect() {
    if (this.destroyed) return;
    this.status = "connecting";
    this.emit();
    const base = signalEndpoint(this.options.signalUrl, "viewer");
    const url = new URL(base);
    url.searchParams.set("stream", this.options.streamId);
    url.searchParams.set("guest", this.options.guestId);
    url.searchParams.set("name", this.options.displayName);
    url.searchParams.set("color", this.options.color);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.status = "connected";
      this.emit();
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      void this.handleServerMessage(message);
    };

    ws.onclose = () => {
      this.ws = null;
      this.status = "offline";
      this.closeAllPeers();
      this.emit();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      this.options.onError?.("Signaling connection failed");
    };
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(15_000, 1500 * this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private async handleServerMessage(message: ServerMessage) {
    if (message.type === "welcome") {
      this.peerId = message.peerId;
      this.iceServers = message.iceServers.length
        ? message.iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }];
      this.status = "connected";
      this.startManifestPolling();
      this.emit();
      return;
    }

    if (message.type === "assign") {
      const previousParent = this.parentId;
      this.parentId = message.parent;
      this.childIds = new Set(message.children);
      if (previousParent && previousParent !== this.parentId) {
        this.closePeer(previousParent);
      }
      if (this.parentId) {
        this.ensurePeer(this.parentId, true, "up");
      } else {
        this.status = this.peers.size ? "connected" : "origin-only";
      }
      this.emit();
      return;
    }

    if (message.type === "signal") {
      await this.handleSignal(message.from, message.payload);
      return;
    }

    if (message.type === "peer-left") {
      this.closePeer(message.peerId);
      this.emit();
      return;
    }

    if (message.type === "error") {
      this.options.onError?.(message.message);
      return;
    }

    if (message.type === "stats") {
      return;
    }
  }

  private async handleSignal(from: string, payload: SignalPayload) {
    let peer = this.peers.get(from);
    if (!peer) {
      const direction = this.parentId === from ? "up" : "down";
      peer = this.ensurePeer(from, false, direction);
    }

    try {
      if (payload.kind === "offer") {
        peer.direction = "down";
        await peer.pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        peer.remoteSet = true;
        await this.flushCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal(from, { kind: "answer", sdp: answer.sdp ?? "" });
        return;
      }
      if (payload.kind === "answer") {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        peer.remoteSet = true;
        await this.flushCandidates(peer);
        return;
      }
      if (payload.kind === "ice") {
        if (peer.remoteSet) {
          await peer.pc.addIceCandidate(payload.candidate).catch(() => undefined);
        } else {
          peer.pendingCandidates.push(payload.candidate);
        }
      }
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : "Peer negotiation failed");
    }
  }

  private async flushCandidates(peer: PeerConnectionState) {
    for (const candidate of peer.pendingCandidates.splice(0)) {
      await peer.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private ensurePeer(
    id: string,
    initiator: boolean,
    direction: "up" | "down",
  ): PeerConnectionState {
    const existing = this.peers.get(id);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: PeerConnectionState = {
      id,
      pc,
      control: null,
      data: null,
      initiator,
      direction,
      remoteSet: false,
      pendingCandidates: [],
      haves: new Set(),
      incoming: new Map(),
      nextTransferId: 1,
      activeServes: 0,
      connected: false,
      lastTransferAt: null,
      disconnectTimer: null,
    };
    this.peers.set(id, peer);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(id, { kind: "ice", candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        peer.connected = true;
        if (peer.disconnectTimer) {
          clearTimeout(peer.disconnectTimer);
          peer.disconnectTimer = null;
        }
        this.status = "connected";
        this.emit();
      } else if (pc.connectionState === "failed") {
        this.options.onError?.("Direct peer connection failed");
        const wasParent = this.parentId === id;
        this.closePeer(id);
        if (wasParent) this.sendSignalRequest();
        this.emit();
      } else if (pc.connectionState === "disconnected") {
        if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
        peer.disconnectTimer = setTimeout(() => {
          if (peer.pc.connectionState === "disconnected") {
            const wasParent = this.parentId === id;
            this.closePeer(id);
            if (wasParent) this.sendSignalRequest();
            this.emit();
          }
        }, 6000);
      }
    };

    pc.ondatachannel = (event) => {
      this.attachChannel(peer, event.channel);
    };

    if (initiator) {
      const control = pc.createDataChannel(DATA_CHANNEL_CONTROL, { ordered: true });
      const data = pc.createDataChannel(DATA_CHANNEL_DATA, { ordered: false });
      this.attachChannel(peer, control);
      this.attachChannel(peer, data);
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendSignal(id, { kind: "offer", sdp: offer.sdp ?? "" });
        } catch {
          this.options.onError?.("Could not create a peer offer");
        }
      })();
    }

    this.emit();
    return peer;
  }

  private attachChannel(peer: PeerConnectionState, channel: RTCDataChannel) {
    channel.bufferedAmountLowThreshold = 512 * 1024;
    if (channel.label === DATA_CHANNEL_CONTROL) {
      peer.control = channel;
      channel.onmessage = (event) => this.handleControl(peer, String(event.data));
    } else if (channel.label === DATA_CHANNEL_DATA) {
      peer.data = channel;
      channel.binaryType = "arraybuffer";
      channel.onmessage = (event) => this.handleBinary(peer, event.data as ArrayBuffer);
    }

    channel.onopen = () => {
      if (peer.control?.readyState === "open" && peer.data?.readyState === "open") {
        this.sendHave(peer);
        this.emit();
      }
    };

    channel.onclose = () => {
      if (peer.control?.readyState === "closed" || peer.data?.readyState === "closed") {
        peer.connected = false;
        this.emit();
      }
    };
  }

  private sendHave(peer: PeerConnectionState) {
    if (!peer.control || peer.control.readyState !== "open") return;
    const keys = [...this.cache.keys()].slice(-MAX_CACHE_ENTRIES);
    if (!keys.length) return;
    peer.control.send(JSON.stringify({ t: "have", keys }));
  }

  private broadcastHave(key: string) {
    for (const peer of this.peers.values()) {
      if (peer.control?.readyState === "open") {
        peer.control.send(JSON.stringify({ t: "have", keys: [key] }));
      }
    }
  }

  private handleControl(peer: PeerConnectionState, raw: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.t === "have" && Array.isArray(message.keys)) {
      for (const key of message.keys) {
        if (typeof key === "string") peer.haves.add(key);
      }
      return;
    }
    if (message.t === "want") {
      const id = Number(message.id);
      const key = String(message.key ?? "");
      if (Number.isFinite(id) && key) void this.servePart(peer, id, key);
      return;
    }
    if (message.t === "xfer") {
      const id = Number(message.id);
      const key = String(message.key ?? "");
      const transfer = peer.incoming.get(id);
      if (!transfer) return;
      transfer.key = key;
      transfer.chunks = Number(message.chunks ?? 0);
      transfer.size = Number(message.size ?? 0);
      return;
    }
    if (message.t === "xfer-error") {
      const id = Number(message.id);
      const transfer = peer.incoming.get(id);
      if (transfer) {
        clearTimeout(transfer.timer);
        peer.incoming.delete(id);
        transfer.reject(new Error("peer unavailable"));
      }
      return;
    }
  }

  private handleBinary(peer: PeerConnectionState, buffer: ArrayBuffer) {
    if (buffer.byteLength < BINARY_HEADER_BYTES) return;
    const view = new DataView(buffer);
    const id = view.getUint32(0);
    const chunkIndex = view.getUint16(4);
    const chunks = view.getUint16(6);
    const payload = new Uint8Array(buffer, BINARY_HEADER_BYTES);
    const transfer = peer.incoming.get(id);
    if (!transfer) return;
    if (!transfer.chunks) {
      transfer.chunks = chunks;
    }
    transfer.parts.set(chunkIndex, payload);
    transfer.received += 1;
    transfer.lastActivity = Date.now();
    if (transfer.received >= transfer.chunks) {
      void this.finishTransfer(peer, id, transfer);
    }
  }

  private async finishTransfer(
    peer: PeerConnectionState,
    id: number,
    transfer: IncomingTransfer,
  ) {
    clearTimeout(transfer.timer);
    peer.incoming.delete(id);
    const parts: Uint8Array[] = [];
    for (let index = 0; index < transfer.chunks; index += 1) {
      const part = transfer.parts.get(index);
      if (!part) {
        transfer.reject(new Error("missing chunk"));
        return;
      }
      parts.push(part);
    }
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    const buffer = output.buffer;
    const expected = this.hashes.get(transfer.key);
    if (expected) {
      const actual = await sha256Hex(buffer);
      if (actual && actual !== expected) {
        transfer.reject(new Error("hash mismatch"));
        this.options.onError?.("Rejected a corrupted peer segment");
        return;
      }
    }
    transfer.resolve(buffer);
  }

  private async servePart(peer: PeerConnectionState, id: number, key: string) {
    if (!this.serving || peer.activeServes >= 2) {
      peer.control?.send(JSON.stringify({ t: "xfer-error", id, reason: "busy" }));
      return;
    }
    const cached = this.cache.get(key);
    if (!cached) {
      peer.control?.send(JSON.stringify({ t: "xfer-error", id, reason: "missing" }));
      return;
    }
    if (!peer.control || !peer.data) return;
    const bytes = new Uint8Array(cached);
    const chunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
    if (chunks > 65535) {
      peer.control.send(JSON.stringify({ t: "xfer-error", id, reason: "too-large" }));
      return;
    }
    peer.activeServes += 1;
    peer.control.send(
      JSON.stringify({ t: "xfer", id, key, size: bytes.byteLength, chunks }),
    );
    try {
      for (let index = 0; index < chunks; index += 1) {
        const start = index * CHUNK_SIZE;
        const chunk = bytes.subarray(start, Math.min(start + CHUNK_SIZE, bytes.byteLength));
        const frame = new ArrayBuffer(BINARY_HEADER_BYTES + chunk.byteLength);
        const view = new DataView(frame);
        view.setUint32(0, id);
        view.setUint16(4, index);
        view.setUint16(6, chunks);
        new Uint8Array(frame, BINARY_HEADER_BYTES).set(chunk);
        await this.waitForBuffer(peer.data);
        if (peer.data.readyState !== "open") throw new Error("channel closed");
        peer.data.send(frame);
      }
      this.counters.servedBytes += bytes.byteLength;
      peer.lastTransferAt = Date.now();
      this.emit();
    } catch {
      // Peer vanished mid-transfer; the requester falls back to origin.
    } finally {
      peer.activeServes -= 1;
    }
  }

  private waitForBuffer(channel: RTCDataChannel) {
    if (channel.bufferedAmount < 512 * 1024) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        channel.removeEventListener("bufferedamountlow", finish);
        resolve();
      };
      const timer = setTimeout(finish, 1200);
      channel.addEventListener("bufferedamountlow", finish);
    });
  }

  private requestFromPeer(
    peer: PeerConnectionState,
    key: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<ArrayBuffer> {
    if (!peer.control || !peer.data) {
      return Promise.reject(new Error("peer not ready"));
    }
    const id = peer.nextTransferId++;
    if (peer.nextTransferId > 0xffffffff) peer.nextTransferId = 1;

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const transfer: IncomingTransfer = {
        key,
        chunks: 0,
        size: 0,
        parts: new Map(),
        early: [],
        received: 0,
        lastActivity: null,
        resolve,
        reject,
        timer: setTimeout(() => {
          peer.incoming.delete(id);
          reject(new Error("peer timeout"));
        }, timeoutMs),
      };
      peer.incoming.set(id, transfer);
      const onAbort = () => {
        clearTimeout(transfer.timer);
        peer.incoming.delete(id);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        peer.control!.send(JSON.stringify({ t: "want", id, key }));
      } catch {
        clearTimeout(transfer.timer);
        peer.incoming.delete(id);
        reject(new Error("could not request"));
      }
    });
  }

  async fetchPart(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const key = new URL(url, typeof location !== "undefined" ? location.origin : "http://localhost")
      .pathname;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const candidates = [...this.peers.values()].filter(
      (peer) =>
        peer.connected &&
        peer.control?.readyState === "open" &&
        peer.data?.readyState === "open" &&
        peer.haves.has(key),
    );
    candidates.sort((a, b) => (b.lastTransferAt ?? 0) - (a.lastTransferAt ?? 0));

    for (const peer of candidates.slice(0, 2)) {
      try {
        const buffer = await this.requestFromPeer(peer, key, 2200, signal);
        this.counters.peerBytes += buffer.byteLength;
        this.remember(key, buffer);
        peer.lastTransferAt = Date.now();
        this.broadcastHave(key);
        this.emit();
        return buffer;
      } catch {
        // try the next peer, then origin
      }
    }

    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) {
      throw new Error(`origin responded ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    this.counters.originBytes += buffer.byteLength;
    this.remember(key, buffer);
    this.broadcastHave(key);
    this.emit();
    return buffer;
  }

  private remember(key: string, buffer: ArrayBuffer) {
    this.cache.set(key, buffer);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
      else break;
    }
  }

  private startManifestPolling() {
    if (this.manifestTimer) return;
    const refresh = async () => {
      try {
        const response = await fetch(
          `${this.options.apiBase}/api/streams/${this.options.streamId}/manifest`,
          { signal: AbortSignal.timeout(2000), cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { hashes?: Record<string, string> };
        if (data.hashes) {
          for (const [key, value] of Object.entries(data.hashes)) {
            this.hashes.set(key, value);
          }
          if (this.hashes.size > 300) {
            const first = this.hashes.keys().next().value;
            if (first) this.hashes.delete(first);
          }
        }
      } catch {
        // manifest is optional; hashes verify when available
      }
    };
    void refresh();
    this.manifestTimer = setInterval(() => void refresh(), 5000);
  }

  private sendSignal(to: string, payload: SignalPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "signal", to, payload }));
    }
  }

  private sendSignalRequest() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "need-parent" }));
    }
  }

  setServing(value: boolean) {
    this.serving = value;
  }

  private closePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
    for (const transfer of peer.incoming.values()) {
      clearTimeout(transfer.timer);
      transfer.reject(new Error("peer closed"));
    }
    peer.pc.close();
    this.peers.delete(id);
    if (this.parentId === id) this.parentId = null;
    this.emit();
  }

  private closeAllPeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  getStats(): SwarmStats {
    return {
      peers: [...this.peers.values()].filter((peer) => peer.connected).length,
      parent: this.parentId,
      children: this.childIds.size,
      cacheEntries: this.cache.size,
      peerBytes: this.counters.peerBytes,
      originBytes: this.counters.originBytes,
      servedBytes: this.counters.servedBytes,
      status: this.status,
    };
  }

  getPeers(): SwarmPeerInfo[] {
    return [...this.peers.values()].map((peer) => ({
      id: peer.id,
      direction: peer.direction,
      connected: peer.connected,
      lastTransferAt: peer.lastTransferAt,
    }));
  }

  private emit() {
    const now = Date.now();
    if (now - this.lastEmit < 250) return;
    this.lastEmit = now;
    this.options.onStats?.(this.getStats());
    this.options.onPeers?.(this.getPeers());
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.manifestTimer) clearInterval(this.manifestTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.ws?.close();
    this.ws = null;
    this.closeAllPeers();
    this.cache.clear();
    this.hashes.clear();
  }
}
