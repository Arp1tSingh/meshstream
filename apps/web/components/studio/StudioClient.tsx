"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Command,
  Copy,
  Disc,
  ExternalLink,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { StreamStats, StreamSummary } from "@meshstream/protocol";
import { Avatar, Badge, Button, Input, Kbd, buttonClass } from "@/components/ui";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useGuest } from "@/components/providers/GuestProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { useMediaCapture } from "@/lib/useMediaCapture";
import { useChat } from "@/lib/useChat";
import { api, ApiError, getApiBase } from "@/lib/api";
import { publishToWhip } from "@/lib/whip";
import { getHost, saveHost } from "@/lib/hostKey";
import { formatDuration, shortId } from "@/lib/format";
import { cn } from "@/lib/cn";
import { HealthPanel } from "./HealthPanel";
import { StudioStage } from "./StudioStage";
import { CommandPalette, type CommandAction } from "./CommandPalette";

type Gate = "checking" | "ready" | "locked" | "notfound" | "error";
type MediaHealth = "checking" | "ok" | "down";

interface WhipMetrics {
  bitrate: number | null;
  fps: number | null;
  rtt: number | null;
  history: number[];
}

const emptyWhip: WhipMetrics = { bitrate: null, fps: null, rtt: null, history: [] };

export function StudioClient({ streamId }: { streamId: string }) {
  const router = useRouter();
  const { guest } = useGuest();
  const { toast } = useToast();
  const capture = useMediaCapture();
  const chat = useChat({ streamId, guest, role: "host" });

  const [gate, setGate] = useState<Gate>("checking");
  const [stream, setStream] = useState<StreamSummary | null>(null);
  const [hostKey, setHostKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [mediaHealth, setMediaHealth] = useState<MediaHealth>("checking");
  const [goingLive, setGoingLive] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [connection, setConnection] = useState<RTCPeerConnectionState | "idle">("idle");
  const [whip, setWhip] = useState<WhipMetrics>(emptyWhip);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const publishingRef = useRef(false);
  const hostKeyRef = useRef("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordMimeRef = useRef("video/webm");

  const live = stream?.state === "live";

  useEffect(() => {
    hostKeyRef.current = hostKey;
  }, [hostKey]);

  useEffect(() => {
    setViewerUrl(`${window.location.origin}/watch/${streamId}`);
  }, [streamId]);

  const verify = useCallback(
    async (key: string) => {
      setVerifying(true);
      setGateError(null);
      try {
        const data = await api<{ stream: StreamSummary }>(`/api/streams/${streamId}/host`, {
          headers: { "x-host-key": key },
        });
        setStream(data.stream);
        setHostKey(key);
        setGate("ready");
        return true;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) {
          setGate("notfound");
          setGateError("This room does not exist on this server.");
        } else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setGate("locked");
          setGateError("That host key does not match this room.");
        } else {
          setGate("error");
          setGateError(cause instanceof Error ? cause.message : "Could not reach the room.");
        }
        return false;
      } finally {
        setVerifying(false);
      }
    },
    [streamId],
  );

  useEffect(() => {
    const record = getHost(streamId);
    if (!record) {
      setGate("locked");
      return;
    }
    setKeyInput(record.hostKey);
    void verify(record.hostKey);
  }, [streamId, verify]);

  useEffect(() => {
    if (gate !== "ready" || !hostKey) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const next = await api<StreamStats>(`/api/streams/${streamId}/stats`, {
          headers: { "x-host-key": hostKey },
        });
        if (disposed) return;
        setStats(next);
        setStream((current) =>
          current
            ? {
                ...current,
                state: next.state,
                viewerCount: next.viewers,
                peerCount: next.peers,
              }
            : current,
        );
      } catch {
        // Keep the last good sample; the UI labels it as live/offline.
      }
    };

    void load();
    timer = setInterval(load, 4000);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [gate, hostKey, streamId]);

  useEffect(() => {
    let disposed = false;
    const check = async () => {
      try {
        const data = await api<{ reachable: boolean }>("/api/media/health");
        if (!disposed) setMediaHealth(data.reachable ? "ok" : "down");
      } catch {
        if (!disposed) setMediaHealth("down");
      }
    };
    void check();
    const timer = setInterval(check, 15_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (stream?.state === "live" || !publishingRef.current) return;
    pcRef.current?.close();
    pcRef.current = null;
    publishingRef.current = false;
    setPublishing(false);
    setConnection("idle");
  }, [stream?.state]);

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      pcRef.current = null;
      if (publishingRef.current && hostKeyRef.current) {
        publishingRef.current = false;
        void fetch(`${getApiBase()}/api/streams/${streamId}/stop`, {
          method: "POST",
          headers: {
            "x-host-key": hostKeyRef.current,
            "content-type": "application/json",
          },
          keepalive: true,
          credentials: "include",
        }).catch(() => undefined);
      }
    };
  }, [streamId]);

  useEffect(() => {
    if (!publishing) {
      setWhip(emptyWhip);
      return;
    }
    let disposed = false;
    let lastBytes = 0;
    let lastAt = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const sample = async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let bytes = 0;
        let fps: number | null = null;
        let rtt: number | null = null;
        report.forEach((entry) => {
          if (entry.type === "outbound-rtp" && entry.kind === "video") {
            if (typeof entry.bytesSent === "number") bytes += entry.bytesSent;
            if (typeof entry.framesPerSecond === "number") fps = entry.framesPerSecond;
          }
          if (
            entry.type === "candidate-pair" &&
            entry.state === "succeeded" &&
            typeof entry.currentRoundTripTime === "number"
          ) {
            if (rtt === null || entry.nominated) rtt = entry.currentRoundTripTime;
          }
        });
        if (disposed) return;
        setConnection(pc.connectionState);
        const now = performance.now();
        let bitrate: number | null = null;
        if (lastAt > 0 && bytes >= lastBytes && now > lastAt) {
          bitrate = ((bytes - lastBytes) * 8) / ((now - lastAt) / 1000) / 1_000_000;
        }
        if (bytes > 0) {
          lastBytes = bytes;
          lastAt = now;
        }
        setWhip((current) => ({
          bitrate,
          fps,
          rtt,
          history:
            bitrate !== null
              ? [...current.history, bitrate].slice(-32)
              : current.history,
        }));
      } catch {
        // getStats can briefly fail while the connection settles.
      }
    };

    void sample();
    timer = setInterval(sample, 2000);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [publishing]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!publishing) return;
    const pc = pcRef.current;
    if (!pc || !capture.stream) return;
    const senders = pc.getSenders();
    const videoSender = senders.find((sender) => sender.track?.kind === "video");
    const audioSender = senders.find((sender) => sender.track?.kind === "audio");
    const nextVideo = capture.stream.getVideoTracks()[0];
    const nextAudio = capture.stream.getAudioTracks()[0];
    if (videoSender && nextVideo && videoSender.track !== nextVideo) {
      void videoSender.replaceTrack(nextVideo).catch(() => undefined);
    }
    if (audioSender && nextAudio && audioSender.track !== nextAudio) {
      void audioSender.replaceTrack(nextAudio).catch(() => undefined);
    }
  }, [capture.stream, publishing]);

  const startRecording = useCallback(() => {
    if (!capture.stream || recorderRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setPublishError("This browser does not support local recording.");
      return;
    }
    try {
      const mime = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(capture.stream, mime ? { mimeType: mime } : undefined);
      recordMimeRef.current = mime ?? "video/webm";
      recordChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: recordMimeRef.current });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `meshstream-${streamId}-${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[:T]/g, "-")}.webm`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        recorderRef.current = null;
        setRecording(false);
        toast("Local recording downloaded", { tone: "success" });
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecordSeconds(0);
      setRecording(true);
      toast("Recording locally — this is not a server VOD");
    } catch (cause) {
      setPublishError(
        cause instanceof Error ? cause.message : "Could not start local recording.",
      );
    }
  }, [capture.stream, streamId, toast]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") recorder.stop();
  }, []);

  const goLive = useCallback(async () => {
    if (!capture.stream) {
      setPublishError("Enable the camera or share a screen before going live.");
      return;
    }
    setGoingLive(true);
    setPublishError(null);
    setWhip(emptyWhip);
    let pc: RTCPeerConnection | null = null;
    try {
      await api<{ stream: StreamSummary }>(`/api/streams/${streamId}/start`, {
        method: "POST",
        headers: { "x-host-key": hostKey },
      });

      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;
      setConnection("new");
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        setConnection(pc.connectionState);
        if (pc.connectionState === "failed") {
          setPublishError(
            "The WHIP connection failed. Check that MediaMTX is running, then end and retry.",
          );
        }
      };
      for (const track of capture.stream.getTracks()) {
        pc.addTransceiver(track, {
          direction: "sendonly",
          streams: [capture.stream],
          sendEncodings:
            track.kind === "video"
              ? [
                  {
                    maxBitrate: 2_500_000,
                    maxFramerate: 30,
                    scaleResolutionDownBy: 1,
                  },
                ]
              : undefined,
        });
      }

      await publishToWhip({ pc, streamId, hostKey });
      publishingRef.current = true;
      setPublishing(true);
      setStats((current) => (current ? { ...current, state: "live" } : current));
      setStream((current) =>
        current
          ? { ...current, state: "live", startedAt: current.startedAt ?? Date.now() }
          : current,
      );
      toast("You are live. Share the viewer link.", { tone: "success" });
    } catch (cause) {
      pc?.close();
      pcRef.current = null;
      publishingRef.current = false;
      setPublishing(false);
      setConnection("idle");
      setStream((current) => (current ? { ...current, state: "idle" } : current));
      setPublishError(
        cause instanceof Error
          ? cause.message
          : "Could not go live. Check the media server and retry.",
      );
      await api(`/api/streams/${streamId}/stop`, {
        method: "POST",
        headers: { "x-host-key": hostKey },
      }).catch(() => undefined);
    } finally {
      setGoingLive(false);
    }
  }, [capture.stream, hostKey, streamId, toast]);

  const endStream = useCallback(async () => {
    stopRecording();
    pcRef.current?.close();
    pcRef.current = null;
    publishingRef.current = false;
    setPublishing(false);
    setConnection("idle");
    setWhip(emptyWhip);
    try {
      await api(`/api/streams/${streamId}/stop`, {
        method: "POST",
        headers: { "x-host-key": hostKey },
      });
      setStream((current) => (current ? { ...current, state: "ended", endedAt: Date.now() } : current));
      setStats((current) => (current ? { ...current, state: "ended" } : current));
      toast("Broadcast ended. The host key still works for a restart.");
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : "Could not end the stream.");
    }
  }, [hostKey, streamId, stopRecording, toast]);

  const copyLink = useCallback(async () => {
    if (!viewerUrl) return;
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopied(true);
      toast("Viewer link copied", { tone: "success" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setPublishError("Clipboard access was blocked. Copy the URL from the address bar.");
    }
  }, [toast, viewerUrl]);

  const openViewer = useCallback(() => {
    if (viewerUrl) window.open(viewerUrl, "_blank", "noopener,noreferrer");
  }, [viewerUrl]);

  const actions = useMemo<CommandAction[]>(
    () => [
      live
        ? {
            id: "end",
            label: "End broadcast",
            hint: "Close the WHIP publisher and mark the room ended",
            icon: <Square className="h-3.5 w-3.5" />,
            run: () => void endStream(),
            disabled: goingLive,
          }
        : {
            id: "live",
            label: "Go live",
            hint: capture.stream ? "Publish the current source over WHIP" : "Enable a camera first",
            icon: <Radio className="h-3.5 w-3.5" />,
            run: () => void goLive(),
            disabled: !capture.stream || goingLive,
          },
      {
        id: "camera",
        label: capture.stream
          ? capture.cameraOn
            ? "Turn camera off"
            : "Turn camera on"
          : "Enable camera",
        hint: "Local preview only until you go live",
        icon: capture.cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />,
        run: () => {
          if (capture.stream) capture.toggleCamera();
          else void capture.start();
        },
        disabled: capture.starting,
      },
      {
        id: "mic",
        label: capture.micOn ? "Mute microphone" : "Unmute microphone",
        hint: "Toggles the outgoing audio track",
        icon: capture.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />,
        run: capture.toggleMic,
        disabled: !capture.stream,
      },
      {
        id: "screen",
        label: "Share a screen",
        hint: "Replaces the outgoing video track",
        icon: <MonitorUp className="h-3.5 w-3.5" />,
        run: () => void capture.startScreen(),
      },
      {
        id: "record",
        label: recording ? "Stop local recording" : "Start local recording",
        hint: recording ? "Download the WebM when it stops" : "Saved in this browser, not on the server",
        icon: <Disc className="h-3.5 w-3.5" />,
        run: recording ? stopRecording : startRecording,
        disabled: !capture.stream && !recording,
      },
      {
        id: "copy",
        label: "Copy viewer link",
        hint: viewerUrl,
        icon: <Copy className="h-3.5 w-3.5" />,
        run: () => void copyLink(),
        disabled: !viewerUrl,
      },
      {
        id: "viewer",
        label: "Open viewer in a new tab",
        hint: "Keeps this studio publishing",
        icon: <ExternalLink className="h-3.5 w-3.5" />,
        run: openViewer,
        disabled: !viewerUrl,
      },
      {
        id: "library",
        label: "Open library",
        hint: "Rooms saved on this device",
        icon: <ArrowRight className="h-3.5 w-3.5" />,
        run: () => router.push("/library"),
      },
      {
        id: "how",
        label: "How the swarm works",
        hint: "Open the animated explainer",
        icon: <ShieldCheck className="h-3.5 w-3.5" />,
        run: () => router.push("/how-it-works"),
      },
    ],
    [
      live,
      goingLive,
      capture,
      endStream,
      goLive,
      recording,
      stopRecording,
      startRecording,
      copyLink,
      viewerUrl,
      openViewer,
      router,
    ],
  );

  if (gate !== "ready") {
    return (
      <StudioGate
        gate={gate}
        streamId={streamId}
        keyInput={keyInput}
        onKeyInput={setKeyInput}
        error={gateError}
        verifying={verifying}
        onVerify={async () => {
          const key = keyInput.trim();
          if (key.length < 12) {
            setGateError("Paste the full host key saved when the room was created.");
            return;
          }
          const ok = await verify(key);
          if (ok) {
            saveHost({
              streamId,
              hostKey: key,
              title: "Restored room",
              createdAt: Date.now(),
            });
            toast("Host controls unlocked", { tone: "success" });
          }
        }}
        onRetry={() => void verify(hostKey || keyInput)}
      />
    );
  }

  const statusLabel = live
    ? publishing
      ? "On air"
      : "Live · no publisher"
    : stream?.state === "ended"
      ? "Ended"
      : "Offline";
  const statusTone = live && publishing ? "danger" : live ? "warn" : stream?.state === "ended" ? "neutral" : "neutral";

  return (
    <main className="mx-auto w-full max-w-[1560px] px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
            <Link href="/studio" className="inline-flex items-center gap-1.5 transition hover:text-muted">
              <ArrowLeft className="h-3 w-3" />
              Studio
            </Link>
            <span className="text-line-strong">/</span>
            <span>{shortId(streamId)}</span>
            <span className="text-line-strong">/</span>
            <span className="text-muted">{stream?.category}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="max-w-2xl truncate text-[24px] tracking-[-0.035em] sm:text-[28px]">
              {stream?.title ?? "Studio"}
            </h1>
            {stream ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em]",
                  statusTone === "danger"
                    ? "border-live/35 bg-live/10 text-live-soft"
                    : statusTone === "warn"
                      ? "border-warn/30 bg-warn/10 text-warn"
                      : "border-line bg-white/[0.03] text-faint",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    statusTone === "danger" ? "bg-live" : statusTone === "warn" ? "bg-warn" : "bg-faint",
                  )}
                />
                {statusLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1.5">
              <Avatar
                name={guest?.displayName ?? stream?.hostName ?? "Guest"}
                color={guest?.color ?? stream?.hostColor ?? "#C9F73A"}
                size={16}
              />
              {stream?.hostName ?? guest?.displayName ?? "Guest"}
            </span>
            <span>{stats?.viewers ?? 0} viewers</span>
            <span>{stats?.peers ?? 0} connected peers</span>
            {live ? <span>{formatDuration(stats?.uptimeSeconds ?? 0)} on air</span> : null}
            {recording ? (
              <span className="inline-flex items-center gap-1.5 text-live-soft">
                <Disc className="h-3 w-3" />
                REC {formatDuration(recordSeconds)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className={buttonClass("secondary", "sm", "hidden sm:inline-flex")}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-lime" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Viewer link"}
          </button>
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className={buttonClass("secondary", "sm", "gap-2")}
          >
            <Command className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Actions</span>
            <Kbd>⌘K</Kbd>
          </button>
          {live ? (
            <Button variant="danger" size="md" onClick={() => void endStream()}>
              <Square className="h-3.5 w-3.5" />
              End stream
            </Button>
          ) : !capture.stream ? (
            <Button onClick={() => void capture.start()} disabled={capture.starting}>
              {capture.starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              Enable camera
            </Button>
          ) : (
            <Button onClick={() => void goLive()} disabled={goingLive}>
              {goingLive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
              {goingLive ? "Going live…" : "Go live"}
            </Button>
          )}
        </div>
      </div>

      {publishError ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-live/25 bg-live/5 px-3.5 py-3 text-[11.5px] leading-relaxed text-live-soft">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{publishError}</span>
          <button
            type="button"
            onClick={() => setPublishError(null)}
            className="text-live-soft/60 transition hover:text-live-soft"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {mediaHealth === "down" ? (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[11px] leading-relaxed text-warn">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            MediaMTX is not reachable. Start it with{" "}
            <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px]">npm run media:start</code>{" "}
            before going live. WHIP publishes will fail until then.
          </span>
        </div>
      ) : null}

      {live && !publishing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[11px] text-warn">
          <CircleAlert className="h-3.5 w-3.5" />
          This room is marked live, but this browser has no active publisher.
          <button
            type="button"
            onClick={() => void endStream()}
            className="ml-auto rounded border border-warn/30 px-2 py-1 text-[10px] transition hover:bg-warn/10"
          >
            End the room
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_332px] xl:grid-cols-[216px_minmax(0,1fr)_332px]">
        <aside className="hidden flex-col gap-4 xl:flex">
          <div className="panel p-3.5">
            <div className="mono-label mb-2.5">Sources</div>
            <div className="space-y-1">
              <SidebarButton
                active={Boolean(capture.stream) && capture.cameraOn && !capture.screen}
                icon={<Video className="h-3.5 w-3.5" />}
                label={capture.stream ? "Camera" : "Start camera"}
                sub={
                  capture.stream
                    ? `${capture.width}×${capture.height}`
                    : "not connected"
                }
                onClick={() => (capture.stream ? capture.toggleCamera() : void capture.start())}
              />
              <SidebarButton
                active={capture.screen}
                icon={<MonitorUp className="h-3.5 w-3.5" />}
                label="Share screen"
                sub="replace video"
                onClick={() => void capture.startScreen()}
              />
              <SidebarButton
                active={capture.micOn && Boolean(capture.stream)}
                icon={capture.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                label={capture.micOn ? "Microphone" : "Muted"}
                sub={`${capture.level}% input`}
                onClick={capture.toggleMic}
              />
            </div>

            <div className="relative mt-3">
              <select
                value={capture.activeCameraId}
                onChange={(event) => void capture.switchCamera(event.target.value)}
                disabled={!capture.cameras.length}
                className="h-8 w-full appearance-none rounded border border-line bg-[#0A0C10] px-2 pr-7 text-[10px] text-muted outline-none transition hover:border-line-strong disabled:opacity-50"
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
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" />
            </div>

            <div className="mt-3 flex h-1.5 items-end gap-[2px]">
              {Array.from({ length: 24 }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-full flex-1 rounded-full",
                    capture.micOn && capture.level > (index / 24) * 100
                      ? index > 19
                        ? "bg-live"
                        : index > 14
                          ? "bg-warn"
                          : "bg-ok"
                      : "bg-line",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="panel p-3.5">
            <div className="mono-label mb-2.5">Output</div>
            <div className="space-y-1">
              <SidebarButton
                active={recording}
                icon={<Disc className="h-3.5 w-3.5" />}
                label={recording ? `Stop · ${formatDuration(recordSeconds)}` : "Record locally"}
                sub="webm · this device"
                onClick={recording ? stopRecording : startRecording}
                disabled={!capture.stream && !recording}
                tone={recording ? "live" : "default"}
              />
              <SidebarButton
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                label="Open viewer"
                sub="new tab"
                onClick={openViewer}
              />
              <SidebarButton
                icon={<Copy className="h-3.5 w-3.5" />}
                label="Copy viewer link"
                sub={shortId(streamId)}
                onClick={() => void copyLink()}
              />
            </div>
          </div>

          <div className="rounded-xl border border-line bg-[#0B0D12] p-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-lime/70" />
              <span className="mono-label">Host session</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-faint">
              This browser holds the only host key. Do not clear site data unless you are done with
              the room.
            </p>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <Avatar
                name={guest?.displayName ?? "Guest"}
                color={guest?.color ?? "#C9F73A"}
                size={22}
              />
              <div className="min-w-0">
                <div className="truncate text-[10.5px] text-muted">
                  {guest?.displayName ?? "Guest"}
                </div>
                <div className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
                  guest · host key saved
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <StudioStage
            capture={capture}
            live={live}
            publishing={publishing}
            connection={connection}
            bitrate={whip.bitrate}
            fps={whip.fps}
            rtt={whip.rtt}
            recording={recording}
            onScreen={() => void capture.startScreen()}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:hidden">
            <div className="panel p-4">
              <div className="mono-label mb-3">Quick controls</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => (capture.stream ? capture.toggleCamera() : void capture.start())}
                  className={buttonClass(capture.cameraOn ? "secondary" : "outline", "sm")}
                >
                  {capture.cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                  Camera
                </button>
                <button
                  type="button"
                  onClick={capture.toggleMic}
                  disabled={!capture.stream}
                  className={buttonClass(capture.micOn ? "secondary" : "outline", "sm")}
                >
                  {capture.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                  {capture.micOn ? "Mic" : "Muted"}
                </button>
                <button
                  type="button"
                  onClick={() => void capture.startScreen()}
                  className={buttonClass("secondary", "sm")}
                >
                  <MonitorUp className="h-3.5 w-3.5" />
                  Screen
                </button>
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  disabled={!capture.stream && !recording}
                  className={buttonClass(recording ? "danger" : "secondary", "sm")}
                >
                  <Disc className="h-3.5 w-3.5" />
                  {recording ? formatDuration(recordSeconds) : "Record"}
                </button>
              </div>
            </div>

            <div className="panel p-4">
              <div className="mono-label mb-2.5">Share the room</div>
              <div className="truncate rounded border border-line bg-[#0A0C10] px-2.5 py-2 font-mono text-[10px] text-faint">
                {viewerUrl || `/watch/${streamId}`}
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => void copyLink()}>
                  {copied ? <Check className="h-3.5 w-3.5 text-lime" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button variant="secondary" size="sm" onClick={openViewer}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
              </div>
            </div>
          </div>

          <div className="panel px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="mono-label">Encoder</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em]",
                    connection === "connected"
                      ? "text-ok"
                      : connection === "failed"
                        ? "text-live-soft"
                        : publishing
                          ? "text-warn"
                          : "text-faint",
                  )}
                >
                  {connection === "connected" ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {connection === "connected" ? "connected" : connection === "failed" ? "failed" : publishing ? "connecting" : "idle"}
                </span>
              </div>
              <div className="h-3 w-px bg-line" />
              <span className="text-[10.5px] text-faint">
                <span className="font-mono text-muted">{whip.bitrate !== null ? whip.bitrate.toFixed(1) : "—"}</span>{" "}
                Mbps upstream
              </span>
              <span className="text-[10.5px] text-faint">
                <span className="font-mono text-muted">{whip.fps !== null ? Math.round(whip.fps) : "—"}</span> fps
              </span>
              <span className="text-[10.5px] text-faint">
                rtt <span className="font-mono text-muted">{whip.rtt !== null ? `${Math.round(whip.rtt * 1000)}ms` : "—"}</span>
              </span>
              <span className="ml-auto hidden font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint/70 sm:inline">
                WHIP → MediaMTX → LL-HLS
              </span>
            </div>
            {capture.stream ? (
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <span className="mono-label">Local tape</span>
                <div className="flex flex-1 items-center gap-1">
                  {Array.from({ length: 48 }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        "h-2 flex-1 rounded-full",
                        recording ? "bg-live/60" : "bg-line",
                      )}
                    />
                  ))}
                </div>
                <span className="font-mono text-[9px] text-faint">
                  {recording ? formatDuration(recordSeconds) : "not recording"}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <HealthPanel
            stats={stats}
            stream={stream}
            bitrate={whip.bitrate}
            history={whip.history}
            publishing={publishing}
          />

          <ChatPanel
            messages={chat.messages}
            connected={chat.connected}
            viewers={chat.viewers}
            error={chat.error}
            onSend={chat.send}
            disabled={!guest}
            title="Studio chat"
            className="h-[420px]"
          />

          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <span className="mono-label">Viewer page</span>
              <Badge tone="neutral">720p</Badge>
            </div>
            <Link
              href={`/watch/${streamId}`}
              target="_blank"
              className="mt-2.5 flex items-center gap-2 rounded-md border border-line bg-[#0A0C10] px-3 py-2 text-[11px] text-muted transition hover:border-line-strong hover:text-ink"
            >
              <ExternalLink className="h-3.5 w-3.5 text-faint" />
              Open /watch/{shortId(streamId).toLowerCase()}
            </Link>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <ShieldCheck className="h-3.5 w-3.5 text-lime/60" />
              <span className="text-[10px] leading-relaxed text-faint">
                Signed playback tokens. Host key never sent to MediaMTX.
              </span>
            </div>
          </div>
        </aside>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} actions={actions} />
    </main>
  );
}

function SidebarButton({
  icon,
  label,
  sub,
  active,
  tone = "default",
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  active?: boolean;
  tone?: "default" | "live";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-line-strong bg-white/[0.045]"
          : "border-transparent hover:border-line hover:bg-white/[0.025]",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded border",
          tone === "live" && active
            ? "border-live/30 bg-live/10 text-live-soft"
            : active
              ? "border-lime/25 bg-lime/10 text-lime"
              : "border-line bg-[#0A0C10] text-faint",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-muted">{label}</span>
        {sub ? (
          <span className="mt-0.5 block truncate font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
            {sub}
          </span>
        ) : null}
      </span>
      {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-lime" /> : null}
    </button>
  );
}

function StudioGate({
  gate,
  streamId,
  keyInput,
  onKeyInput,
  error,
  verifying,
  onVerify,
  onRetry,
}: {
  gate: Gate;
  streamId: string;
  keyInput: string;
  onKeyInput: (value: string) => void;
  error: string | null;
  verifying: boolean;
  onVerify: () => void;
  onRetry: () => void;
}) {
  if (gate === "checking") {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-lime" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            checking host key
          </span>
        </div>
      </main>
    );
  }

  if (gate === "notfound") {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center px-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-raised">
          <Radio className="h-6 w-6 text-faint" />
        </span>
        <h1 className="mt-6 text-[30px] tracking-[-0.03em]">Room not found.</h1>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          {error ?? "This room does not exist on the configured API."}
        </p>
        <Link href="/studio" className={buttonClass("primary", "md", "mt-6")}>
          Create a new room
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[75vh] w-full max-w-[460px] flex-col justify-center px-4">
      <div className="panel p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-lime/25 bg-lime/10 text-lime">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <div className="mono-label text-lime/70">Host controls</div>
            <div className="text-[13px] font-medium text-ink">This room is locked</div>
          </div>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          The host key was generated when this room was created and stored in this browser. Paste it
          to restore control. The server only keeps its hash.
        </p>

        <div className="mt-5 space-y-2">
          <label htmlFor="host-key" className="mono-label text-muted">
            Host key
          </label>
          <Input
            id="host-key"
            type="password"
            value={keyInput}
            onChange={(event) => onKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onVerify();
            }}
            placeholder="Paste host key…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[12px]"
          />
        </div>

        {error ? (
          <div className="mt-3 flex gap-2 rounded-md border border-live/25 bg-live/5 p-3 text-[11px] leading-relaxed text-live-soft">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <Button className="mt-4 w-full" size="lg" onClick={onVerify} disabled={verifying}>
          {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clipboard className="h-4 w-4" />}
          {verifying ? "Checking…" : "Unlock studio"}
        </Button>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/watch/${streamId}`}
            className="inline-flex items-center gap-1 text-[10.5px] text-faint transition hover:text-muted"
          >
            View as audience
            <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            href="/studio"
            className="inline-flex items-center gap-1 text-[10.5px] text-faint transition hover:text-muted"
          >
            Create another room
          </Link>
        </div>

        {gate === "error" ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-raised px-3 py-2 text-[11px] text-muted transition hover:text-ink"
          >
            <RefreshCw className="h-3 w-3" />
            Retry connection
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint/70">
        <Keyboard className="h-3 w-3" />
        host key · {shortId(streamId)}
      </div>
    </main>
  );
}
