"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  Check,
  Copy,
  Eye,
  Info,
  Loader2,
  Radio,
  Share2,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { StreamSummary, SwarmStats } from "@meshstream/protocol";
import type { SwarmPeerInfo } from "@meshstream/swarm";
import { Avatar, Badge, LiveBadge, buttonClass } from "@/components/ui";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Player, type PlaybackMetrics } from "@/components/viewer/Player";
import { SwarmPanel } from "@/components/viewer/SwarmPanel";
import { useGuest } from "@/components/providers/GuestProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { api } from "@/lib/api";
import { useChat } from "@/lib/useChat";
import { formatCount, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

const emptyMetrics: PlaybackMetrics = {
  latency: null,
  buffer: 0,
  bitrate: null,
  history: [],
};

export function ViewerClient({ streamId }: { streamId: string }) {
  const { guest, loading: guestLoading } = useGuest();
  const { toast } = useToast();
  const [stream, setStream] = useState<StreamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [metrics, setMetrics] = useState<PlaybackMetrics>(emptyMetrics);
  const [stats, setStats] = useState<SwarmStats | null>(null);
  const [peers, setPeers] = useState<SwarmPeerInfo[]>([]);
  const [copied, setCopied] = useState(false);

  const chat = useChat({ streamId, guest, role: "viewer" });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const data = await api<StreamSummary>(`/api/streams/${streamId}`);
        if (disposed) return;
        setStream(data);
        setNotFound(false);
      } catch {
        if (!disposed) setNotFound(true);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();
    timer = setInterval(() => void load(), 12_000);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [streamId]);

  const onMetrics = useCallback((next: PlaybackMetrics) => setMetrics(next), []);
  const onSwarmStats = useCallback((next: SwarmStats) => setStats(next), []);
  const onPeers = useCallback((next: SwarmPeerInfo[]) => setPeers(next), []);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: stream?.title ?? "MeshStream", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Viewer link copied", { tone: "success" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sharing can be cancelled; ignore.
    }
  };

  const viewers = Math.max(stream?.viewerCount ?? 0, chat.viewers);
  const live = stream?.state === "live";

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-[1480px] items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-lime" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            locating stream
          </span>
        </div>
      </main>
    );
  }

  if (notFound || !stream) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-raised">
          <Radio className="h-6 w-6 text-faint" />
        </span>
        <h1 className="mt-6 text-[30px] tracking-[-0.03em]">This room does not exist.</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          The link may be wrong, or the broadcast was removed. The live page is the best place to
          find another room.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/" className={buttonClass("primary", "md")}>
            Browse live
          </Link>
          <Link href="/studio" className={buttonClass("secondary", "md")}>
            Open the studio
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-5 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
          <Link href="/" className="inline-flex items-center gap-1.5 transition hover:text-muted">
            <ArrowLeft className="h-3 w-3" />
            Live
          </Link>
          <span className="text-line-strong">/</span>
          <span className="text-muted">{stream.category}</span>
        </div>
        <div className="flex items-center gap-2">
          {live ? <LiveBadge /> : <Badge tone="neutral">{stream.state === "idle" ? "Not started" : "Ended"}</Badge>}
          <button
            type="button"
            onClick={() => void share()}
            className={buttonClass("secondary", "sm")}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-lime" /> : <Share2 className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Share"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_346px]">
        <div className="min-w-0 space-y-4">
          {live ? (
            <Player
              streamId={streamId}
              guest={guest}
              onMetrics={onMetrics}
              onSwarmStats={onSwarmStats}
              onPeers={onPeers}
            />
          ) : (
            <OfflineStage stream={stream} />
          )}

          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                {live ? (
                  <LiveBadge />
                ) : (
                  <Badge tone="neutral">{stream.state === "idle" ? "Preview" : "Offline"}</Badge>
                )}
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
                  {stream.category}
                </span>
              </div>
              <h1 className="mt-2.5 text-[27px] leading-[1.1] tracking-[-0.035em] sm:text-[34px]">
                {stream.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-muted">
                <span className="inline-flex items-center gap-2">
                  <Avatar name={stream.hostName} color={stream.hostColor} size={22} />
                  <span className="text-[#C4CAD4]">{stream.hostName}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-faint" />
                  {formatCount(viewers)} watching
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-faint" />
                  {stream.peerCount} peers
                </span>
                {stream.startedAt ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-faint" />
                    live {timeAgo(stream.startedAt)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-md border border-line bg-[#0C0E13] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                guest · no account
              </span>
            </div>
          </div>

          <SwarmPanel
            stats={stats}
            peers={peers}
            latency={metrics.latency}
            buffer={metrics.buffer}
            history={metrics.history}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <ChatPanel
            messages={chat.messages}
            connected={chat.connected}
            viewers={chat.viewers}
            error={chat.error}
            onSend={chat.send}
            disabled={!guest || guestLoading || !live}
            className="h-[420px] xl:h-[560px]"
          />

          <div className="panel p-4">
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-muted" />
              <span className="mono-label">About this room</span>
            </div>
            <div className="mt-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="text-faint">Host</span>
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: stream.hostColor }}
                  />
                  {stream.hostName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="text-faint">Quality</span>
                <span className="font-mono text-[10.5px] text-muted">720p · 30 fps</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="text-faint">Latency</span>
                <span className="font-mono text-[10.5px] text-muted">
                  {metrics.latency !== null ? `${metrics.latency.toFixed(1)}s live` : "low-latency"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="text-faint">Delivery</span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-lime">
                  <ShieldCheck className="h-3 w-3" />
                  verified parts
                </span>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-line bg-[#0A0C10] p-3">
              <p className="text-[10.5px] leading-relaxed text-faint">
                Parts travel through nearby viewers first. If a peer cannot deliver, the player
                quietly uses origin. No account, no email, no install.
              </p>
              <Link
                href="/how-it-works"
                className="mt-2.5 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-lime/80 transition hover:text-lime"
              >
                See the mechanism
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-[#0C0E13] p-4">
            <div className="mono-label mb-2">Share the room</div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate rounded-md border border-line bg-[#0A0C10] px-2.5 py-2 font-mono text-[10px] text-faint">
                /watch/{stream.id}
              </div>
              <button
                type="button"
                onClick={() => void share()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-muted transition hover:border-line-strong hover:text-ink"
                aria-label="Copy viewer link"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-faint">
              More viewers make the swarm stronger. Origin still carries the seeds.
            </p>
          </div>

          <Link
            href="/studio"
            className={cn(
              "group flex items-center justify-between rounded-xl border border-line bg-[#0C0E13] p-4 transition hover:border-lime/30",
            )}
          >
            <div>
              <div className="mono-label mb-1">Have something to say?</div>
              <div className="text-[13px] font-medium text-ink">Open your own studio</div>
            </div>
            <Radio className="h-4 w-4 text-lime transition group-hover:scale-110" />
          </Link>
        </aside>
      </div>
    </main>
  );
}

function OfflineStage({ stream }: { stream: StreamSummary }) {
  return (
    <div className="relative flex aspect-video w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-line bg-[#090B0E] px-6 text-center">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(201,247,58,0.06),transparent_65%)]" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-line bg-[#0C0E13]">
        <Radio className="h-6 w-6 text-faint" />
      </div>
      <h2 className="relative mt-5 text-[23px] tracking-[-0.03em] text-ink">
        {stream.state === "idle" ? "The room is set up, but not live yet." : "This broadcast has ended."}
      </h2>
      <p className="relative mt-2 max-w-md text-[12.5px] leading-relaxed text-muted">
        {stream.state === "idle"
          ? "The host is still preparing. The player will appear here as soon as they go live."
          : "The host stopped publishing. You can still read the chat history, or find another room on the live page."}
      </p>
      <div className="relative mt-5 flex flex-wrap justify-center gap-2.5">
        <Link href="/" className={buttonClass("primary", "md")}>
          Find another stream
        </Link>
        <Link href={`/studio/${stream.id}`} className={buttonClass("secondary", "md")}>
          Host controls
        </Link>
      </div>
      <div className="relative mt-8 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-faint/70">
        <span className="h-1 w-1 rounded-full bg-faint" />
        origin ready · swarm idle
      </div>
    </div>
  );
}
