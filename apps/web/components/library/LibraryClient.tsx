"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  KeyRound,
  Radio,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import type { StreamSummary } from "@meshstream/protocol";
import { Avatar, Badge, EmptyState, LiveBadge, buttonClass } from "@/components/ui";
import { useToast } from "@/components/providers/ToastProvider";
import { api } from "@/lib/api";
import { listHosts, removeHost, type HostRecord } from "@/lib/hostKey";
import { formatCount, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";

interface HostedRoom {
  record: HostRecord;
  stream: StreamSummary | null;
}

function RoomArt({ color, seed, live }: { color: string; seed: string; live: boolean }) {
  const offset = (seed.charCodeAt(0) + seed.charCodeAt(1)) % 30;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0A0C10]">
      <div className="absolute inset-0 grid-lines opacity-50" />
      <div
        className="absolute -left-12 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: color, opacity: live ? 0.2 : 0.09 }}
      />
      <svg viewBox="0 0 320 180" className="absolute inset-0 h-full w-full" aria-hidden>
        <g stroke={live ? "#3B452A" : "#252B36"} strokeWidth="1">
          <line x1="62" y1="90" x2="148" y2="56" />
          <line x1="62" y1="90" x2="148" y2="124" />
          <line x1="148" y1="56" x2="236" y2="90" />
          <line x1="148" y1="124" x2="236" y2="90" />
          <line x1="236" y1="90" x2="282" y2="62" />
          <line x1="236" y1="90" x2="282" y2="118" />
        </g>
        <circle cx="62" cy="90" r="12" fill="#0D1015" stroke={live ? "#C9F73A" : "#323947"} strokeOpacity={live ? 0.6 : 1} />
        <circle cx="62" cy="90" r="3" fill={live ? "#C9F73A" : "#5B6472"} />
        {[
          [148, 56],
          [148, 124],
          [236, 90],
          [282, 62],
          [282, 118],
        ].map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r="6" fill="#0D1015" stroke="#2C333F" />
        ))}
        <circle cx="236" cy="90" r="8" fill="#10140C" stroke={live ? "#C9F73A" : "#323947"} strokeOpacity="0.55" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#0A0C10] to-transparent" />
      <div className="absolute bottom-3 left-3" style={{ marginLeft: offset / 6 }}>
        <Badge tone={live ? "live" : "neutral"}>{live ? "Live" : "Offline"}</Badge>
      </div>
    </div>
  );
}

export function LibraryClient() {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<HostedRoom[] | null>(null);
  const [liveRooms, setLiveRooms] = useState<StreamSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [forgetId, setForgetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const records = listHosts();
    const settled = await Promise.all(
      records.slice(0, 24).map(async (record) => {
        try {
          const stream = await api<StreamSummary>(`/api/streams/${record.streamId}`);
          return { record, stream };
        } catch {
          return { record, stream: null };
        }
      }),
    );
    setRooms(settled);
    try {
      setLiveRooms(await api<StreamSummary[]>("/api/streams/live"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the live directory.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy(streamId: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/watch/${streamId}`);
      setCopiedId(streamId);
      toast("Viewer link copied", { tone: "success" });
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast("Clipboard access was blocked", { tone: "error" });
    }
  }

  const hostIds = new Set(rooms?.map((room) => room.record.streamId) ?? []);
  const liveCount = rooms?.filter((room) => room.stream?.state === "live").length ?? 0;

  return (
    <main className="mx-auto w-full max-w-[1320px] px-5 py-10 lg:px-8 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mono-label flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-lime" />
            This device
          </div>
          <h1 className="mt-4 text-[38px] leading-[0.98] tracking-[-0.04em] sm:text-[48px]">
            Your library.
          </h1>
          <p className="mt-4 max-w-xl text-[13px] leading-[1.7] text-muted">
            Rooms created in this browser, plus everything currently live on this MeshStream
            instance. Host keys never leave local storage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            <KeyRound className="h-3 w-3" />
            {rooms?.length ?? 0} host key{rooms?.length === 1 ? "" : "s"}
          </Badge>
          <Badge tone={liveCount > 0 ? "live" : "neutral"}>
            <Radio className="h-3 w-3" />
            {liveCount} live
          </Badge>
          <Link href="/studio" className={buttonClass("primary", "md")}>
            <Radio className="h-3.5 w-3.5" />
            New room
          </Link>
        </div>
      </div>

      <div className="mt-10 flex items-center gap-3 border-b border-line pb-3">
        <h2 className="text-[16px] font-medium text-ink">Your rooms</h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
          saved host keys
        </span>
      </div>

      {rooms === null ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-5 w-5" />}
          title="No rooms on this device yet"
          body="Create a room and its host key will be saved here. It is the only way back into the studio, so keep this browser profile around."
          action={
            <Link href="/studio" className={buttonClass("primary", "md")}>
              <Radio className="h-3.5 w-3.5" />
              Set up a broadcast
            </Link>
          }
          className="mt-5"
        />
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => {
            const stream = room.stream;
            const live = stream?.state === "live";
            return (
              <div
                key={room.record.streamId}
                className="group overflow-hidden rounded-xl border border-line bg-[#0A0C10] transition hover:border-line-strong"
              >
                <Link href={`/watch/${room.record.streamId}`} className="block">
                  <div className="relative aspect-video w-full overflow-hidden border-b border-line">
                    <RoomArt
                      color={stream?.hostColor ?? "#C9F73A"}
                      seed={room.record.streamId}
                      live={live}
                    />
                    {live ? (
                      <div className="absolute right-3 top-3 rounded-full border border-live/30 bg-black/55 px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-live-soft backdrop-blur">
                        {stream?.viewerCount ?? 0} watching
                      </div>
                    ) : null}
                  </div>
                </Link>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/watch/${room.record.streamId}`}
                        className="block truncate text-[13.5px] font-medium text-ink transition hover:text-lime"
                      >
                        {stream?.title ?? room.record.title ?? "Untitled room"}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
                        <span>{stream?.category ?? "unknown"}</span>
                        <span>·</span>
                        <span>{stream ? timeAgo(stream.startedAt ?? room.record.createdAt) : "not found"}</span>
                      </div>
                    </div>
                    <Badge tone={live ? "live" : stream?.state === "idle" ? "warn" : "neutral"}>
                      {live ? "Live" : stream?.state === "idle" ? "Ready" : "Ended"}
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3">
                    <Link
                      href={`/studio/${room.record.streamId}`}
                      className={buttonClass("secondary", "sm", "flex-1")}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Studio
                    </Link>
                    <button
                      type="button"
                      onClick={() => void copy(room.record.streamId)}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-muted transition hover:border-line-strong hover:text-ink"
                      aria-label="Copy viewer link"
                    >
                      {copiedId === room.record.streamId ? (
                        <Check className="h-3.5 w-3.5 text-lime" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (forgetId !== room.record.streamId) {
                          setForgetId(room.record.streamId);
                          setTimeout(() => setForgetId((current) => (current === room.record.streamId ? null : current)), 3000);
                          return;
                        }
                        removeHost(room.record.streamId);
                        setForgetId(null);
                        setRooms((current) =>
                          current?.filter((entry) => entry.record.streamId !== room.record.streamId) ?? null,
                        );
                        toast("Host key removed from this browser");
                      }}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-md border text-[10px] transition",
                        forgetId === room.record.streamId
                          ? "border-live/30 bg-live/10 px-2 text-live-soft"
                          : "w-8 border-line text-faint hover:border-live/25 hover:text-live-soft",
                      )}
                      aria-label="Forget room"
                    >
                      {forgetId === room.record.streamId ? "Forget?" : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-14 flex items-center gap-3 border-b border-line pb-3">
        <h2 className="text-[16px] font-medium text-ink">Live on this instance</h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
          public rooms
        </span>
        <Link
          href="/#live"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-faint transition hover:text-muted"
        >
          Homepage
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {error ? (
        <div className="mt-5 rounded-xl border border-line bg-[#0A0C10] p-6">
          <div className="mono-label mb-2 text-warn">Directory unavailable</div>
          <p className="max-w-lg text-[12px] leading-relaxed text-muted">{error}</p>
        </div>
      ) : liveRooms.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-line bg-[#0A0C10] px-6 py-12 text-center">
          <Radio className="mx-auto h-5 w-5 text-faint" />
          <p className="mt-3 text-[13px] font-medium text-ink">No public rooms are live.</p>
          <p className="mt-1 text-[11.5px] text-faint">
            The directory updates when hosts publish. Your rooms stay visible here regardless.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {liveRooms.map((stream) => (
            <Link
              key={stream.id}
              href={`/watch/${stream.id}`}
              className="group overflow-hidden rounded-xl border border-line bg-[#0A0C10] transition hover:border-line-strong"
            >
              <div className="relative aspect-video overflow-hidden border-b border-line">
                <RoomArt color={stream.hostColor} seed={stream.id} live />
                <div className="absolute left-3 top-3">
                  <LiveBadge />
                </div>
                {hostIds.has(stream.id) ? (
                  <div className="absolute right-3 top-3">
                    <Badge tone="lime">Yours</Badge>
                  </div>
                ) : null}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-[13.5px] font-medium text-ink transition group-hover:text-lime">
                    {stream.title}
                  </h3>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint transition group-hover:text-lime" />
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-faint">
                  <Avatar name={stream.hostName} color={stream.hostColor} size={18} />
                  <span className="truncate text-muted">{stream.hostName}</span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[9px]">
                    <Users className="h-3 w-3" />
                    {formatCount(stream.viewerCount)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5 text-[10px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="h-3 w-3 text-lime/60" />
          Host keys are hashed on the server and stored raw only here.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3 w-3 text-lime/60" />
          Clearing site data removes access to these rooms.
        </span>
        <Link
          href="/settings"
          className="ml-auto inline-flex items-center gap-1.5 transition hover:text-muted"
        >
          Manage local data
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </main>
  );
}
