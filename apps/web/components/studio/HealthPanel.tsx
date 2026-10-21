"use client";

import {
  Activity,
  CircleGauge,
  Clock3,
  CloudUpload,
  Network,
  Users,
} from "lucide-react";
import type { StreamStats, StreamSummary } from "@meshstream/protocol";
import { Sparkline } from "@/components/ui";
import { formatDuration, formatMbps } from "@/lib/format";
import { cn } from "@/lib/cn";

const gradeCopy: Record<StreamStats["health"], string> = {
  A: "Plenty of origin headroom. The swarm is carrying its share.",
  B: "Healthy. Keep an eye on origin egress as the room grows.",
  C: "Under pressure. Origin is close to its comfortable budget.",
  D: "Over budget. Add viewers with good uplinks, or lower the source bitrate.",
  F: "Origin is saturated. Playback is at risk until the room shrinks.",
};

export function HealthPanel({
  stats,
  stream,
  bitrate,
  history,
  publishing,
}: {
  stats: StreamStats | null;
  stream: StreamSummary | null;
  bitrate: number | null;
  history: number[];
  publishing: boolean;
}) {
  const live = stats?.state === "live";
  const grade = live ? (stats?.health ?? null) : null;
  const gradeTone =
    grade === "A" || grade === "B"
      ? "text-ok"
      : grade === "C"
        ? "text-warn"
        : grade
          ? "text-live-soft"
          : "text-faint";
  const ratio = stats ? Math.min(1, stats.originMbps / Math.max(1, stats.originBudgetMbps)) : 0;
  const ratioTone = ratio > 0.95 ? "bg-live" : ratio > 0.75 ? "bg-warn" : "bg-lime";

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2">
          <CircleGauge className="h-3.5 w-3.5 text-muted" />
          <span className="text-[12px] font-medium text-ink">Room health</span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
          {live ? "live" : "offline"}
        </span>
      </div>

      <div className="flex items-center gap-4 border-b border-line px-4 py-4">
        <div
          className={cn(
            "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border font-mono text-[26px] leading-none",
            live
              ? "border-line bg-[#0A0C10]"
              : "border-line bg-[#0A0C10] opacity-50",
            gradeTone,
          )}
        >
          {grade ?? "—"}
          <span className="mt-1 font-sans text-[7.5px] uppercase tracking-[0.14em] text-faint">
            health
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-ink">
            {!live
              ? "Ready when you are"
              : !publishing
                ? "Live · waiting for publisher"
                : "Publishing to origin"}
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
            {!live
              ? "Start the camera and go live to populate the room metrics."
              : grade
                ? gradeCopy[grade]
                : "Collecting the first signal sample…"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-line">
        <div className="bg-[#0C0E13] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-faint" />
            <span className="mono-label">Viewers</span>
          </div>
          <div className="metric mt-2 text-[18px] text-ink">{stats?.viewers ?? 0}</div>
        </div>
        <div className="bg-[#0C0E13] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Network className="h-3 w-3 text-faint" />
            <span className="mono-label">Peers / edges</span>
          </div>
          <div className="metric mt-2 text-[18px] text-ink">
            {stats?.peers ?? 0}
            <span className="ml-1 text-[10px] text-faint">/ {stats?.edges ?? 0}</span>
          </div>
        </div>
        <div className="bg-[#0C0E13] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <CloudUpload className="h-3 w-3 text-faint" />
            <span className="mono-label">Your encoder</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="metric text-[18px] text-ink">
              {bitrate !== null ? bitrate.toFixed(1) : "—"}
            </span>
            <span className="text-[9.5px] text-faint">Mbps</span>
          </div>
          <div className="mt-1">
            <Sparkline data={history} width={80} height={20} color="#5B9DFF" />
          </div>
        </div>
        <div className="bg-[#0C0E13] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Clock3 className="h-3 w-3 text-faint" />
            <span className="mono-label">Uptime</span>
          </div>
          <div className="metric mt-2 text-[18px] text-ink">
            {formatDuration(stats?.uptimeSeconds ?? 0)}
          </div>
        </div>
      </div>

      <div className="border-t border-line px-4 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="mono-label">Origin egress</span>
          <span className="font-mono text-[10px] text-muted">
            {stats ? formatMbps(stats.originMbps) : "—"}
            <span className="text-faint"> / {stats?.originBudgetMbps ?? 12} Mbps</span>
          </span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", ratioTone)}
            style={{ width: `${Math.max(2, ratio * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
          <span>guardrail</span>
          <span>{Math.round(ratio * 100)}% used</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
          <Activity className="h-3 w-3 text-lime/60" />
          {stream?.category ?? "uncategorized"}
        </span>
        <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint/70">
          signal / 4s
        </span>
      </div>
    </div>
  );
}
