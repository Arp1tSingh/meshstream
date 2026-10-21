"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Cable,
  Cloud,
  Info,
  Network,
  ShieldCheck,
} from "lucide-react";
import type { SwarmStats } from "@meshstream/protocol";
import type { SwarmPeerInfo } from "@meshstream/swarm";
import { Badge, Sparkline } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MeshGraph } from "./MeshGraph";

const statusLabel: Record<SwarmStats["status"], string> = {
  connecting: "Connecting",
  connected: "Peers connected",
  "origin-only": "Origin only",
  offline: "Signal offline",
};

const statusTone: Record<SwarmStats["status"], "neutral" | "lime" | "warn"> = {
  connecting: "warn",
  connected: "lime",
  "origin-only": "neutral",
  offline: "warn",
};

export function SwarmPanel({
  stats,
  peers,
  latency,
  buffer,
  history,
}: {
  stats: SwarmStats | null;
  peers: SwarmPeerInfo[];
  latency: number | null;
  buffer: number;
  history: number[];
}) {
  const peerBytes = stats?.peerBytes ?? 0;
  const originBytes = stats?.originBytes ?? 0;
  const servedBytes = stats?.servedBytes ?? 0;
  const total = peerBytes + originBytes;
  const offload = total > 0 ? peerBytes / total : 0;
  const connected = peers.filter((peer) => peer.connected).length;

  return (
    <div className="panel noise overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-lime/25 bg-lime/10 text-lime">
            <Network className="h-4 w-4" />
          </span>
          <div>
            <div className="mono-label text-lime/70">Peer-assisted delivery</div>
            <div className="text-[13px] font-medium text-ink">Your local swarm</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone[stats?.status ?? "connecting"]}>
            <span
              className={cn(
                "h-1 w-1 rounded-full",
                stats?.status === "connected"
                  ? "bg-lime"
                  : stats?.status === "offline"
                    ? "bg-live"
                    : "bg-warn",
              )}
            />
            {statusLabel[stats?.status ?? "connecting"]}
          </Badge>
          <Link
            href="/how-it-works"
            className="hidden items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint transition hover:text-muted sm:inline-flex"
          >
            How it works
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_268px]">
        <div className="relative min-h-[260px] border-b border-line lg:border-b-0 lg:border-r">
          <MeshGraph peers={peers} status={stats?.status ?? "connecting"} offload={offload} />
        </div>

        <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-1">
          <div className="bg-[#0C0E13] px-4 py-3.5">
            <div className="mono-label mb-1.5">Peer offload</div>
            <div className="flex items-baseline gap-1.5">
              <span className="metric text-[21px] text-lime">{(offload * 100).toFixed(0)}%</span>
              <span className="text-[10px] text-faint">this session</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-lime transition-[width] duration-500"
                style={{ width: `${Math.min(100, offload * 100)}%` }}
              />
            </div>
          </div>

          <div className="bg-[#0C0E13] px-4 py-3.5">
            <div className="mono-label mb-1.5">Direct peers</div>
            <div className="flex items-baseline gap-1.5">
              <span className="metric text-[21px] text-ink">{connected}</span>
              <span className="text-[10px] text-faint">
                {stats?.children ? `${stats.children} child${stats.children === 1 ? "" : "ren"}` : "one parent"}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3 font-mono text-[9px] text-faint">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                down
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-info" />
                up
              </span>
            </div>
          </div>

          <div className="bg-[#0C0E13] px-4 py-3.5">
            <div className="mono-label mb-1.5">From peers / origin</div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="text-lime">{formatBytes(peerBytes)}</span>
              <span className="text-faint">/</span>
              <span className="text-muted">{formatBytes(originBytes)}</span>
            </div>
            <div className="mt-1 text-[10px] text-faint">
              served {formatBytes(servedBytes)} upstream
            </div>
          </div>

          <div className="bg-[#0C0E13] px-4 py-3.5">
            <div className="mono-label mb-1.5">Playback</div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="metric text-[16px] text-ink">
                  {latency !== null ? `${latency.toFixed(1)}s` : "—"}
                </div>
                <div className="mt-0.5 text-[9.5px] text-faint">live latency</div>
              </div>
              <Sparkline data={history} width={64} height={24} />
            </div>
            <div className="mt-1 text-[10px] text-faint">{buffer.toFixed(1)}s buffered</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3">
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
          <ShieldCheck className="h-3 w-3 text-lime/60" />
          SHA-256 verified parts
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
          <Cable className="h-3 w-3 text-lime/60" />
          {stats?.cacheEntries ?? 0} cached parts
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
          <Cloud className="h-3 w-3 text-warn/70" />
          origin fallback ready
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint/70">
          <Info className="h-3 w-3" />
          local view, not room telemetry
        </span>
      </div>
    </div>
  );
}
