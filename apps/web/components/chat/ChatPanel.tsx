"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, WifiOff } from "lucide-react";
import type { ChatMessage } from "@meshstream/protocol";
import { Avatar, Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  messages,
  connected,
  viewers,
  error,
  onSend,
  disabled,
  className,
  title = "Live chat",
}: {
  messages: ChatMessage[];
  connected: boolean;
  viewers: number;
  error: string | null;
  onSend: (body: string) => boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  function submit() {
    if (disabled) return;
    if (onSend(draft)) setDraft("");
  }

  return (
    <div className={cn("panel flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted" />
          <span className="text-[12px] font-medium text-ink">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={connected ? "neutral" : "warn"} className="gap-1">
            {connected ? (
              <span className="h-1 w-1 rounded-full bg-ok" />
            ) : (
              <WifiOff className="h-2.5 w-2.5" />
            )}
            {connected ? "Live" : "Offline"}
          </Badge>
          <span className="font-mono text-[9.5px] text-faint">{formatCount(viewers)} here</span>
        </div>
      </div>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-32 flex-col items-center justify-center text-center">
            <MessageSquare className="h-5 w-5 text-faint" />
            <p className="mt-2 max-w-[200px] text-[11px] leading-relaxed text-faint">
              No messages yet. Say hello — no account needed.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="flex gap-2.5">
              <Avatar name={message.displayName} color={message.color} size={22} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className="truncate text-[11.5px] font-medium"
                    style={{ color: message.color }}
                  >
                    {message.displayName}
                  </span>
                  {message.role === "host" ? (
                    <span className="rounded border border-lime/25 bg-lime/10 px-1 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-lime">
                      host
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 font-mono text-[8.5px] text-faint/70">
                    {timeLabel(message.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-[12px] leading-relaxed text-[#C4CAD4]">
                  {message.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {error ? (
        <div className="border-t border-line px-4 py-2 text-[10.5px] text-warn">{error}</div>
      ) : null}

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-md border border-line bg-[#0A0C10] p-1.5 focus-within:border-lime/40">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 300))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={disabled ? "Guest session unavailable" : "Send a message…"}
            disabled={disabled || !connected}
            className="max-h-24 min-h-7 flex-1 resize-none bg-transparent px-1.5 py-1 text-[12px] text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !connected || !draft.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-lime text-[#08090B] transition hover:bg-[#d6ff57] disabled:bg-raised disabled:text-faint"
            aria-label="Send message"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5">
          <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint/70">
            Enter to send · 1.5 s slow mode
          </span>
          <span className="font-mono text-[8.5px] text-faint/70">{draft.length}/300</span>
        </div>
      </div>
    </div>
  );
}
