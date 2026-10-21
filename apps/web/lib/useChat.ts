"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatServerMessage } from "@meshstream/protocol";
import type { Guest } from "@meshstream/protocol";
import { api, getSignalBase, resolveWsPath } from "@/lib/api";

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-200);
}

export function useChat({
  streamId,
  guest,
  role = "viewer",
}: {
  streamId: string;
  guest: Guest | null;
  role?: "viewer" | "host";
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!guest) return;
    closedRef.current = false;
    let attempt = 0;

    void api<{ messages: ChatMessage[] }>(`/api/streams/${streamId}/chat`)
      .then((data) => {
        setMessages((current) => mergeMessages(current, data.messages));
      })
      .catch(() => {
        // live chat still works if history is unavailable
      });

    const connect = () => {
      if (closedRef.current) return;
      let url: URL;
      try {
        url = new URL(resolveWsPath(getSignalBase(), "chat"));
      } catch {
        setError("Chat is unavailable");
        return;
      }
      url.searchParams.set("stream", streamId);
      url.searchParams.set("guest", guest.id);
      url.searchParams.set("name", guest.displayName);
      url.searchParams.set("color", guest.color);
      if (role === "host") url.searchParams.set("role", "host");

      let socket: WebSocket;
      try {
        socket = new WebSocket(url.toString());
      } catch {
        setError("Chat is unavailable");
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        setError(null);
      };

      socket.onmessage = (event) => {
        let message: ChatServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ChatServerMessage;
        } catch {
          return;
        }
        if (message.type === "history") {
          setMessages((current) => mergeMessages(current, message.messages));
        } else if (message.type === "message") {
          setMessages((current) => mergeMessages(current, [message.message]));
        } else if (message.type === "presence") {
          setViewers(message.viewers);
        } else if (message.type === "error") {
          setError(message.message);
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (closedRef.current) return;
        attempt += 1;
        retryRef.current = setTimeout(connect, Math.min(12_000, 1000 * attempt));
      };

      socket.onerror = () => {
        setConnected(false);
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [streamId, guest, role]);

  const send = useCallback((body: string) => {
    const socket = socketRef.current;
    const trimmed = body.trim().slice(0, 300);
    if (!trimmed) return false;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Chat is reconnecting — try again in a moment.");
      return false;
    }
    socket.send(JSON.stringify({ type: "chat:send", body: trimmed }));
    return true;
  }, []);

  return { messages, connected, viewers, error, send };
}
