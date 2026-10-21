import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import type {
  ChatMessage,
  ChatServerMessage,
  ClientMessage,
  IceServer,
  ServerMessage,
  SignalPayload,
} from "@meshstream/protocol";

function loadEnvFiles() {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        // ignore
      }
      break;
    }
  }
}
loadEnvFiles();

const PORT = Number(process.env.SIGNAL_PORT ?? 4001);
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "meshstream-dev-internal-secret";

const MAX_CHILDREN = 4;
const MAX_DEPTH = 4;
const ORIGIN_SEEDS = 2;
const MAX_PEERS = 80;
const MAX_CHAT = 100;
const ICE_SERVERS: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

interface Peer {
  id: string;
  streamId: string;
  ws: WebSocket;
  guestId: string;
  displayName: string;
  color: string;
  parentId: string | null;
  children: Set<string>;
  depth: number;
  joinedAt: number;
  alive: boolean;
}

interface Room {
  streamId: string;
  peers: Map<string, Peer>;
  hosts: Set<WebSocket>;
  chatSockets: Set<WebSocket>;
  chat: ChatMessage[];
  timer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();

function getRoom(streamId: string): Room {
  let room = rooms.get(streamId);
  if (!room) {
    room = {
      streamId,
      peers: new Map(),
      hosts: new Set(),
      chatSockets: new Set(),
      chat: [],
      timer: null,
    };
    rooms.set(streamId, room);
  }
  return room;
}

function send(ws: WebSocket, message: ServerMessage | ChatServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room: Room, message: ServerMessage, includeHosts = true) {
  const raw = JSON.stringify(message);
  for (const peer of room.peers.values()) {
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(raw);
  }
  if (includeHosts) {
    for (const ws of room.hosts) if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  }
}

function chatBroadcast(room: Room, message: ChatServerMessage) {
  const raw = JSON.stringify(message);
  for (const ws of room.chatSockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  }
}

function collectSubtree(room: Room, peerId: string, out = new Set<string>()) {
  out.add(peerId);
  const peer = room.peers.get(peerId);
  if (!peer) return out;
  for (const child of peer.children) collectSubtree(room, child, out);
  return out;
}

function setDepth(room: Room, peer: Peer, depth: number) {
  peer.depth = depth;
  for (const childId of peer.children) {
    const child = room.peers.get(childId);
    if (child) setDepth(room, child, depth + 1);
  }
}

function chooseParent(room: Room, exclude: Set<string>): Peer | null {
  const roots = [...room.peers.values()].filter((p) => p.parentId === null).length;
  if (roots < ORIGIN_SEEDS && exclude.size === 0) return null;

  const candidates = [...room.peers.values()].filter(
    (peer) =>
      !exclude.has(peer.id) &&
      peer.children.size < MAX_CHILDREN &&
      peer.depth < MAX_DEPTH &&
      peer.ws.readyState === WebSocket.OPEN,
  );
  candidates.sort((a, b) => a.depth - b.depth || a.children.size - b.children.size);
  return candidates[0] ?? null;
}

function roomStats(room: Room) {
  let edges = 0;
  let maxDepth = 0;
  for (const peer of room.peers.values()) {
    edges += peer.children.size;
    if (peer.depth > maxDepth) maxDepth = peer.depth;
  }
  return {
    viewers: room.peers.size,
    peers: room.peers.size,
    edges,
    maxDepth,
  };
}

function broadcastStats(room: Room) {
  const stats = roomStats(room);
  broadcast(room, { type: "stats", ...stats }, true);
  chatBroadcast(room, { type: "presence", viewers: stats.viewers });
}

function startRoomTimer(room: Room) {
  if (room.timer) return;
  room.timer = setInterval(() => {
    if (room.peers.size === 0 && room.hosts.size === 0 && room.chatSockets.size === 0) {
      if (room.timer) clearInterval(room.timer);
      room.timer = null;
      rooms.delete(room.streamId);
      return;
    }
    broadcastStats(room);
  }, 3000);
}

function assignPeer(room: Room, peer: Peer, parent: Peer | null) {
  peer.parentId = parent?.id ?? null;
  peer.depth = parent ? parent.depth + 1 : 1;
  if (parent) parent.children.add(peer.id);
  setDepth(room, peer, peer.depth);
  send(peer.ws, {
    type: "assign",
    parent: peer.parentId,
    children: [...peer.children],
    iceServers: ICE_SERVERS,
  });
}

function removePeer(room: Room, peer: Peer) {
  const parent = peer.parentId ? room.peers.get(peer.parentId) : null;
  if (parent) parent.children.delete(peer.id);
  room.peers.delete(peer.id);

  for (const childId of peer.children) {
    const child = room.peers.get(childId);
    if (!child) continue;
    child.parentId = null;
    const exclude = collectSubtree(room, child.id);
    const newParent = chooseParent(room, exclude);
    child.parentId = newParent?.id ?? null;
    child.depth = newParent ? newParent.depth + 1 : 1;
    if (newParent) newParent.children.add(child.id);
    setDepth(room, child, child.depth);
    send(child.ws, {
      type: "assign",
      parent: child.parentId,
      children: [...child.children],
      iceServers: ICE_SERVERS,
    });
  }

  broadcast(room, { type: "peer-left", peerId: peer.id });
  broadcastStats(room);
}

function handleViewer(ws: WebSocket, url: URL) {
  const streamId = url.searchParams.get("stream") ?? "";
  const guestId = url.searchParams.get("guest") ?? "anon";
  const displayName = (url.searchParams.get("name") ?? "Guest").slice(0, 24);
  const color = (url.searchParams.get("color") ?? "#C9F73A").slice(0, 9);
  if (!/^[a-z0-9]{4,32}$/.test(streamId)) {
    send(ws, { type: "error", message: "invalid stream" });
    ws.close();
    return;
  }
  const room = getRoom(streamId);
  if (room.peers.size >= MAX_PEERS) {
    send(ws, { type: "error", message: "stream is at capacity" });
    ws.close();
    return;
  }

  const peer: Peer = {
    id: randomUUID(),
    streamId,
    ws,
    guestId,
    displayName,
    color,
    parentId: null,
    children: new Set(),
    depth: 1,
    joinedAt: Date.now(),
    alive: true,
  };

  // Choose the parent before inserting the new peer so the root count is
  // accurate. The first ORIGIN_SEEDS viewers must remain roots.
  const parent = chooseParent(room, new Set());
  room.peers.set(peer.id, peer);

  if (parent) parent.children.add(peer.id);
  peer.parentId = parent?.id ?? null;
  peer.depth = parent ? parent.depth + 1 : 1;

  send(ws, { type: "welcome", peerId: peer.id, streamId, iceServers: ICE_SERVERS });
  send(ws, {
    type: "assign",
    parent: peer.parentId,
    children: [],
    iceServers: ICE_SERVERS,
  });
  startRoomTimer(room);
  broadcastStats(room);

  let messageCount = 0;
  let windowStart = Date.now();

  ws.on("message", (data) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      messageCount = 0;
    }
    if (++messageCount > 80) {
      ws.close();
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    if (message.type === "signal") {
      const target = room.peers.get(message.to);
      if (!target) return;
      const payload = message.payload as SignalPayload;
      if (!payload || typeof payload !== "object") return;
      const raw = JSON.stringify({ type: "signal", from: peer.id, payload });
      if (raw.length > 64_000) return;
      if (target.ws.readyState === WebSocket.OPEN) target.ws.send(raw);
      return;
    }

    if (message.type === "need-parent") {
      const exclude = collectSubtree(room, peer.id);
      const newParent = chooseParent(room, exclude);
      const oldParent = peer.parentId ? room.peers.get(peer.parentId) : null;
      if (oldParent) oldParent.children.delete(peer.id);
      if (newParent) newParent.children.add(peer.id);
      peer.parentId = newParent?.id ?? null;
      peer.depth = newParent ? newParent.depth + 1 : 1;
      setDepth(room, peer, peer.depth);
      send(ws, {
        type: "assign",
        parent: peer.parentId,
        children: [...peer.children],
        iceServers: ICE_SERVERS,
      });
      broadcastStats(room);
      return;
    }

    if (message.type === "ping") {
      send(ws, { type: "stats", ...roomStats(room) });
    }
  });

  ws.on("close", () => {
    peer.alive = false;
    removePeer(room, peer);
  });
  ws.on("error", () => {
    peer.alive = false;
  });
}

function handleStudio(ws: WebSocket, url: URL) {
  const streamId = url.searchParams.get("stream") ?? "";
  if (!/^[a-z0-9]{4,32}$/.test(streamId)) {
    ws.close();
    return;
  }
  const room = getRoom(streamId);
  room.hosts.add(ws);
  startRoomTimer(room);
  send(ws, { type: "stats", ...roomStats(room) });
  ws.on("close", () => room.hosts.delete(ws));
  ws.on("error", () => room.hosts.delete(ws));
}

function handleChat(ws: WebSocket, url: URL) {
  const streamId = url.searchParams.get("stream") ?? "";
  const guestId = url.searchParams.get("guest") ?? "anon";
  const displayName = (url.searchParams.get("name") ?? "Guest").slice(0, 24);
  const color = (url.searchParams.get("color") ?? "#C9F73A").slice(0, 9);
  const role = url.searchParams.get("role") === "host" ? "host" : "viewer";
  if (!/^[a-z0-9]{4,32}$/.test(streamId)) {
    ws.close();
    return;
  }
  const room = getRoom(streamId);
  room.chatSockets.add(ws);
  startRoomTimer(room);
  send(ws, { type: "history", messages: room.chat.slice(-MAX_CHAT) });
  send(ws, { type: "presence", viewers: room.peers.size });

  let lastSent = 0;
  ws.on("message", (data) => {
    let message: { type?: string; body?: unknown };
    try {
      message = JSON.parse(data.toString()) as { type?: string; body?: unknown };
    } catch {
      return;
    }
    if (message.type !== "chat:send") return;
    const now = Date.now();
    if (now - lastSent < 1500) {
      send(ws, { type: "error", message: "Slow down a little." });
      return;
    }
    lastSent = now;
    const body = typeof message.body === "string" ? message.body.trim().slice(0, 300) : "";
    if (!body) return;
    const chat: ChatMessage = {
      id: randomUUID(),
      streamId,
      guestId,
      displayName,
      color,
      body,
      createdAt: now,
      role,
    };
    room.chat.push(chat);
    if (room.chat.length > MAX_CHAT) room.chat.shift();
    chatBroadcast(room, { type: "message", message: chat });

    void fetch(`${API_INTERNAL_URL}/api/internal/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(chat),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {
      // Chat remains live in memory if persistence is unavailable.
    });
  });

  ws.on("close", () => room.chatSockets.delete(ws));
  ws.on("error", () => room.chatSockets.delete(ws));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/health") {
    res.end(JSON.stringify({ ok: true, service: "meshstream-signal", rooms: rooms.size }));
    return;
  }
  if (url.pathname === "/stats") {
    const streamId = url.searchParams.get("stream") ?? "";
    const room = rooms.get(streamId);
    res.end(
      JSON.stringify(
        room
          ? roomStats(room)
          : { viewers: 0, peers: 0, edges: 0, maxDepth: 0 },
      ),
    );
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request: IncomingMessage, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (!["/ws/viewer", "/ws/studio", "/ws/chat"].includes(url.pathname)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    if (url.pathname === "/ws/viewer") handleViewer(ws, url);
    else if (url.pathname === "/ws/studio") handleStudio(ws, url);
    else handleChat(ws, url);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (peer.ws.readyState === WebSocket.OPEN) peer.ws.ping();
    }
  }
}, 30_000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MeshStream signal on ws://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
