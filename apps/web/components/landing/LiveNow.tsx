"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Radio, Users } from "lucide-react";
import type { StreamSummary } from "@meshstream/protocol";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Avatar, Badge, EmptyState, LiveBadge, buttonClass } from "@/components/ui";

function StreamThumb({ color, seed }: { color: string; seed: string }) {
  const offset = seed.charCodeAt(0) % 40;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0A0C10]">
      <div className="absolute inset-0 grid-lines opacity-60" />
      <div
        className="absolute -left-10 top-1/2 h-44 w-44 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: color, opacity: 0.13 }}
      />
      <svg viewBox="0 0 320 180" className="absolute inset-0 h-full w-full" aria-hidden>
        <g stroke="#2A303B" strokeWidth="1">
          <line x1="70" y1="90" x2="150" y2="52" />
          <line x1="70" y1="90" x2="150" y2="128" />
          <line x1="150" y1="52" x2="238" y2="90" />
          <line x1="150" y1="128" x2="238" y2="90" />
          <line x1="238" y1="90" x2="282" y2="60" />
          <line x1="238" y1="90" x2="282" y2="122" />
        </g>
        <circle cx="70" cy="90" r="13" fill="#0D1015" stroke="#3A4230" />
        <circle cx="70" cy="90" r="3.5" fill={color} />
        {[
          [150, 52],
          [150, 128],
          [238, 90],
          [282, 60],
          [282, 122],
        ].map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r="7"
            fill="#0D1015"
            stroke="#2C333F"
            strokeWidth="1"
          />
        ))}
        <circle cx="238" cy="90" r="9" fill="#11160D" stroke={color} strokeOpacity="0.6" />
      </svg>
      <div
        className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0A0C10] to-transparent"
        style={{ paddingLeft: offset }}
      />
    </div>
  );
}

export function LiveNow() {
  const [streams, setStreams] = useState<StreamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<StreamSummary[]>("/api/streams/live")
      .then((data) => {
        if (!cancelled) setStreams(data);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "API unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="live" className="mx-auto w-full max-w-[1320px] px-5 py-20 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono-label mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-live" />
            On air right now
          </div>
          <h2 className="text-[30px] tracking-[-0.04em] sm:text-[36px]">Live now</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            {streams ? `${streams.length} room${streams.length === 1 ? "" : "s"}` : "…"}
          </span>
          <Link href="/studio" className={buttonClass("secondary", "sm")}>
            <Radio className="h-3.5 w-3.5" />
            Open a room
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-line bg-[#0A0C10] p-8">
          <div className="mono-label mb-2 text-warn">API offline</div>
          <p className="max-w-lg text-[13px] leading-relaxed text-muted">
            The live directory is unavailable. Start the local stack with{" "}
            <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">
              npm run dev
            </code>{" "}
            and refresh. The rest of the site still works.
          </p>
        </div>
      ) : streams === null ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-line bg-[#0A0C10]">
              <div className="skeleton aspect-video w-full" />
              <div className="space-y-3 p-4">
                <div className="skeleton h-4 w-2/3 rounded" />
                <div className="skeleton h-3 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : streams.length === 0 ? (
        <EmptyState
          icon={<Radio className="h-5 w-5" />}
          title="The room is quiet"
          body="No one is live on this MeshStream instance yet. Be the first — the studio runs in your browser and takes about thirty seconds to set up."
          action={
            <Link href="/studio" className={buttonClass("primary", "md")}>
              <Radio className="h-3.5 w-3.5" />
              Be the first to go live
            </Link>
          }
          className="bg-[#0A0C10]/60 py-20"
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map((stream) => (
            <Link
              key={stream.id}
              href={`/watch/${stream.id}`}
              className="group overflow-hidden rounded-xl border border-line bg-[#0A0C10] transition hover:border-line-strong"
            >
              <div className="relative aspect-video w-full overflow-hidden border-b border-line">
                <StreamThumb color={stream.hostColor} seed={stream.id} />
                <div className="absolute left-3 top-3">
                  <LiveBadge />
                </div>
                <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-line bg-black/50 px-2 py-1 font-mono text-[10px] text-muted backdrop-blur">
                  <Users className="h-3 w-3" />
                  {stream.viewerCount}
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-3">
                  <Badge>{stream.category}</Badge>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-black/50 text-muted opacity-0 transition group-hover:opacity-100">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
              <div className="p-4">
                <h3 className="truncate text-[14px] font-medium text-ink group-hover:text-lime">
                  {stream.title}
                </h3>
                <div className="mt-3 flex items-center gap-2.5">
                  <Avatar name={stream.hostName} color={stream.hostColor} size={22} />
                  <span className="truncate text-[11.5px] text-muted">{stream.hostName}</span>
                  <span className="text-faint">·</span>
                  <span className="text-[11px] text-faint">
                    {timeAgo(stream.startedAt)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
