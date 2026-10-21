"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  Server,
  ShieldCheck,
  Trash2,
  Video,
  VideoOff,
  Wifi,
} from "lucide-react";
import { CATEGORIES, type StreamSummary } from "@meshstream/protocol";
import { Avatar, Badge, Button, Field, Input, Switch } from "@/components/ui";
import { useGuest } from "@/components/providers/GuestProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { useMediaCapture } from "@/lib/useMediaCapture";
import { api } from "@/lib/api";
import {
  getP2pPreference,
  listHosts,
  removeHost,
  saveHost,
  setP2pPreference,
  type HostRecord,
} from "@/lib/hostKey";
import { cn } from "@/lib/cn";

type MediaHealth = "checking" | "reachable" | "down";

export function PreflightClient() {
  const router = useRouter();
  const { guest } = useGuest();
  const { toast } = useToast();
  const capture = useMediaCapture();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("Just Chatting");
  const [p2p, setP2p] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaHealth, setMediaHealth] = useState<MediaHealth>("checking");
  const [hosts, setHosts] = useState<HostRecord[]>([]);
  const [secure, setSecure] = useState(true);

  useEffect(() => {
    setP2p(getP2pPreference());
    setHosts(listHosts());
    setSecure(
      typeof window !== "undefined" &&
        (window.isSecureContext || window.location.hostname === "localhost"),
    );
    void api<{ reachable: boolean }>("/api/media/health")
      .then((data) => setMediaHealth(data.reachable ? "reachable" : "down"))
      .catch(() => setMediaHealth("down"));
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = capture.stream;
  }, [capture.stream]);

  async function createRoom() {
    const clean = title.trim();
    if (clean.length < 3) {
      setError("Give the room a title of at least 3 characters.");
      return;
    }
    if (!guest) {
      setError("Your guest session is still starting. Try again in a moment.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const data = await api<{ stream: StreamSummary; hostKey: string }>("/api/streams", {
        method: "POST",
        body: JSON.stringify({ title: clean, category }),
      });
      saveHost({
        streamId: data.stream.id,
        hostKey: data.hostKey,
        title: data.stream.title,
        createdAt: Date.now(),
      });
      toast("Room created. Your host key is saved in this browser.", { tone: "success" });
      router.push(`/studio/${data.stream.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the room.");
    } finally {
      setCreating(false);
    }
  }

  function forget(streamId: string) {
    removeHost(streamId);
    setHosts(listHosts());
    toast("Host key removed from this browser", { tone: "default" });
  }

  return (
    <main className="mx-auto w-full max-w-[1320px] px-5 py-10 lg:px-8 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-lime/70">
            <span className="h-1 w-1 rounded-full bg-lime" />
            Studio / setup
          </div>
          <h1 className="mt-4 text-[38px] leading-[0.98] tracking-[-0.04em] sm:text-[48px]">
            Set up your
            <br />
            broadcast.
          </h1>
          <p className="mt-4 max-w-xl text-[13px] leading-[1.7] text-muted">
            Check the camera, name the room, and you are one click from 720p. No account, no email,
            no download. Your host key stays in this browser.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Badge tone={secure ? "lime" : "warn"}>
            <ShieldCheck className="h-3 w-3" />
            {secure ? "Secure context" : "HTTPS required"}
          </Badge>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
            guest · {guest?.displayName ?? "creating…"}
          </span>
        </div>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Camera className="h-4 w-4 text-muted" />
              <span className="text-[12.5px] font-medium text-ink">Camera check</span>
            </div>
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  capture.stream ? "bg-ok" : capture.starting ? "bg-warn" : "bg-faint",
                )}
              />
              {capture.stream ? "Preview running" : capture.starting ? "Starting" : "Not started"}
            </span>
          </div>

          <div className="relative aspect-video w-full overflow-hidden bg-[#08090B]">
            <div className="pointer-events-none absolute inset-0 grid-lines opacity-25" />
            {capture.stream ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={cn(
                  "relative h-full w-full",
                  capture.screen ? "object-contain" : "object-cover",
                )}
              />
            ) : (
              <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-[#0C0E13]">
                  {capture.starting ? (
                    <Loader2 className="h-5 w-5 animate-spin text-lime" />
                  ) : (
                    <VideoOff className="h-5 w-5 text-faint" />
                  )}
                </span>
                <p className="mt-4 text-[14px] font-medium text-ink">
                  {capture.starting ? "Waking up the camera…" : "Your camera is still private."}
                </p>
                <p className="mt-1.5 max-w-xs text-[11.5px] leading-relaxed text-faint">
                  The preview stays on this device. Nothing is uploaded until you go live in the
                  studio.
                </p>
                <Button
                  className="mt-5"
                  onClick={() => void capture.start()}
                  disabled={capture.starting}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Enable camera
                </Button>
              </div>
            )}

            {capture.stream ? (
              <>
                <div className="pointer-events-none absolute inset-4 rounded border border-dashed border-white/15" />
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded border border-white/10 bg-black/45 px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-white/70 backdrop-blur">
                  <span className="h-1 w-1 rounded-full bg-lime" />
                  Local preview
                </div>
                <div className="absolute bottom-3 right-3 rounded border border-white/10 bg-black/45 px-2 py-1 font-mono text-[8.5px] text-white/60 backdrop-blur">
                  {capture.width}×{capture.height} · {Math.round(capture.frameRate)} fps
                </div>
              </>
            ) : null}
          </div>

          <div className="border-t border-line p-4">
            {capture.error ? (
              <div className="mb-3 flex gap-2 rounded-md border border-warn/25 bg-warn/5 p-3 text-[11.5px] leading-relaxed text-warn">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {capture.error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[190px] flex-1">
                <select
                  value={capture.activeCameraId}
                  onChange={(event) => void capture.switchCamera(event.target.value)}
                  className="h-9 w-full appearance-none rounded-md border border-line bg-[#0A0C10] pl-8 pr-8 text-[11.5px] text-muted outline-none transition hover:border-line-strong focus:border-lime/50"
                  aria-label="Camera device"
                >
                  {capture.cameras.length === 0 ? (
                    <option value="">Default camera</option>
                  ) : (
                    capture.cameras.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))
                  )}
                </select>
                <Video className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              </div>

              <button
                type="button"
                onClick={capture.toggleCamera}
                disabled={!capture.stream}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border px-3 text-[11.5px] transition disabled:opacity-40",
                  capture.cameraOn
                    ? "border-line bg-raised text-ink"
                    : "border-live/25 bg-live/5 text-live-soft",
                )}
              >
                {capture.cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                {capture.cameraOn ? "Camera on" : "Camera off"}
              </button>

              <button
                type="button"
                onClick={capture.toggleMic}
                disabled={!capture.stream}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border px-3 text-[11.5px] transition disabled:opacity-40",
                  capture.micOn
                    ? "border-line bg-raised text-ink"
                    : "border-live/25 bg-live/5 text-live-soft",
                )}
              >
                {capture.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                {capture.micOn ? "Mic on" : "Muted"}
              </button>

              <button
                type="button"
                onClick={() => void capture.startScreen()}
                className="flex h-9 items-center gap-2 rounded-md border border-line bg-raised px-3 text-[11.5px] text-muted transition hover:border-line-strong hover:text-ink"
              >
                <MonitorUp className="h-3.5 w-3.5" />
                Share screen
              </button>

              {capture.stream ? (
                <button
                  type="button"
                  onClick={capture.stop}
                  className="ml-auto flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[11px] text-faint transition hover:text-muted"
                >
                  Stop camera
                </button>
              ) : null}
            </div>

            <div className="mt-3 flex items-center gap-2.5">
              <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">
                Input
              </span>
              <div className="flex h-2 flex-1 items-center gap-[2px]">
                {Array.from({ length: 28 }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-full flex-1 rounded-full transition-colors",
                      capture.micOn && capture.level > (index / 28) * 100
                        ? index > 22
                          ? "bg-live"
                          : index > 17
                            ? "bg-warn"
                            : "bg-ok"
                        : "bg-line",
                    )}
                  />
                ))}
              </div>
              <span className="w-8 text-right font-mono text-[9px] text-faint">
                {capture.micOn ? capture.level : 0}
              </span>
            </div>
          </div>
        </section>

        <section className="panel flex flex-col p-5">
          <div className="flex items-center gap-2.5">
            <Radio className="h-4 w-4 text-lime" />
            <span className="text-[12.5px] font-medium text-ink">Room details</span>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Stream title" hint={`${title.length}/80`} htmlFor="stream-title">
              <Input
                id="stream-title"
                value={title}
                onChange={(event) => setTitle(event.target.value.slice(0, 80))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createRoom();
                }}
                placeholder="Late night build session"
                autoFocus
              />
            </Field>

            <Field label="Category" htmlFor="stream-category">
              <div className="relative">
                <select
                  id="stream-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-10 w-full appearance-none rounded-md border border-line bg-[#0A0C10] px-3 pr-9 text-[13px] text-ink outline-none transition hover:border-line-strong focus:border-lime/60"
                >
                  {CATEGORIES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              </div>
            </Field>

            <div className="rounded-lg border border-line bg-[#0A0C10] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11.5px] font-medium text-ink">720p · 30 fps</div>
                  <div className="mt-0.5 text-[10px] text-faint">H.264 + Opus · ~2.5 Mbps uplink</div>
                </div>
                <span className="rounded border border-lime/20 bg-lime/5 px-1.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-lime">
                  locked
                </span>
              </div>
              <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
                v1 ships one rendition. No transcoding, no ABR ladder, no surprise upload spikes.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-[#0A0C10] p-3.5">
              <Switch
                checked={p2p}
                onCheckedChange={(value) => {
                  setP2p(value);
                  setP2pPreference(value);
                }}
                label="Peer-assisted delivery"
              />
              <p className="mt-2 pl-[42px] text-[10px] leading-relaxed text-faint">
                Let viewers exchange verified parts. Origin fallback always stays on.
              </p>
            </div>
          </div>

          {error ? (
            <div className="mt-4 flex gap-2 rounded-md border border-live/25 bg-live/5 p-3 text-[11.5px] leading-relaxed text-live-soft">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          ) : null}

          <Button
            className="mt-5 w-full"
            size="lg"
            onClick={() => void createRoom()}
            disabled={creating || title.trim().length < 3}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
            {creating ? "Creating room…" : "Create room"}
            {!creating ? <ArrowRight className="h-4 w-4" /> : null}
          </Button>
          <p className="mt-2.5 text-center font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint/70">
            host key saved to this browser · no account
          </p>
        </section>
      </div>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
        <div className="panel p-5">
          <div className="mono-label mb-3.5">Preflight checklist</div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <CheckRow
              ok={Boolean(guest)}
              label="Guest identity"
              detail={guest ? `${guest.displayName} · this device` : "Creating…"}
            />
            <CheckRow
              ok={secure}
              label="Secure context"
              detail={secure ? "Camera APIs available" : "Use HTTPS or localhost"}
            />
            <CheckRow
              ok={capture.stream ? capture.cameraOn : true}
              label="Video source"
              detail={capture.stream ? "Camera ready" : "Can be enabled in studio"}
              tone={capture.stream ? "ok" : "neutral"}
            />
            <CheckRow
              ok={mediaHealth === "reachable"}
              label="Media server"
              detail={
                mediaHealth === "checking"
                  ? "Checking localhost:8888…"
                  : mediaHealth === "reachable"
                    ? "MediaMTX reachable"
                    : "Start MediaMTX before going live"
              }
              tone={mediaHealth === "down" ? "warn" : undefined}
            />
          </div>
          {mediaHealth === "down" ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warn/25 bg-warn/5 p-3 text-[10.5px] leading-relaxed text-warn">
              <Server className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                The API is up, but MediaMTX is not reachable. Run{" "}
                <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[9.5px]">
                  npm run media:start
                </code>{" "}
                (after{" "}
                <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[9.5px]">
                  npm run media:setup
                </code>
                ) and recheck. You can still create the room now.
              </span>
            </div>
          ) : null}
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <div className="mono-label">Rooms on this device</div>
            <span className="font-mono text-[9px] text-faint">{hosts.length}</span>
          </div>
          {hosts.length === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-line px-4 py-6 text-center">
              <Clock3 className="mx-auto h-4 w-4 text-faint" />
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Your rooms and host keys appear here. They never leave this browser unless you share
                one.
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {hosts.slice(0, 4).map((record) => (
                <li key={record.streamId} className="flex items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/studio/${record.streamId}`}
                      className="block truncate text-[11.5px] text-muted transition hover:text-ink"
                    >
                      {record.title || "Untitled room"}
                    </Link>
                    <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
                      {new Date(record.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Link
                    href={`/watch/${record.streamId}`}
                    className="flex h-7 w-7 items-center justify-center rounded text-faint transition hover:bg-white/5 hover:text-ink"
                    aria-label="Open viewer page"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => forget(record.streamId)}
                    className="flex h-7 w-7 items-center justify-center rounded text-faint transition hover:bg-live/10 hover:text-live-soft"
                    aria-label="Forget this room"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hosts.length > 4 ? (
            <div className="mt-2 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
              +{hosts.length - 4} older rooms in /library
            </div>
          ) : null}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10.5px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3 text-lime/60" />
          Host key hashed server-side
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wifi className="h-3 w-3 text-lime/60" />
          WHIP publish · LL-HLS playback
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={guest?.displayName ?? "Guest"} color={guest?.color ?? "#C9F73A"} size={16} />
          {guest?.displayName ?? "Guest"}
        </span>
      </div>
    </main>
  );
}

function CheckRow({
  ok,
  label,
  detail,
  tone,
}: {
  ok: boolean;
  label: string;
  detail: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const resolved = tone ?? (ok ? "ok" : "warn");
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-line bg-[#0A0C10] p-3">
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          resolved === "ok"
            ? "border-ok/40 bg-ok/10 text-ok"
            : resolved === "warn"
              ? "border-warn/40 bg-warn/10 text-warn"
              : "border-line bg-raised text-faint",
        )}
      >
        {resolved === "ok" ? <Check className="h-2.5 w-2.5" /> : <span className="h-1 w-1 rounded-full bg-current" />}
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-[10px] leading-snug text-faint">{detail}</div>
      </div>
    </div>
  );
}
