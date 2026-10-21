"use client";

import { useEffect, useRef } from "react";
import {
  Camera,
  CircleAlert,
  Disc,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { MediaCaptureController } from "@/lib/useMediaCapture";
import { cn } from "@/lib/cn";

export function StudioStage({
  capture,
  live,
  publishing,
  connection,
  bitrate,
  fps,
  rtt,
  recording,
  onScreen,
}: {
  capture: MediaCaptureController;
  live: boolean;
  publishing: boolean;
  connection: RTCPeerConnectionState | "idle";
  bitrate: number | null;
  fps: number | null;
  rtt: number | null;
  recording: boolean;
  onScreen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (element) element.srcObject = capture.stream;
  }, [capture.stream]);

  const connected = connection === "connected";
  const failed = connection === "failed" || connection === "disconnected";
  const videoOff = Boolean(capture.stream) && !capture.cameraOn;

  return (
    <div
      className={cn(
        "panel overflow-hidden transition-shadow",
        live && publishing ? "shadow-[0_0_0_1px_rgba(255,90,95,0.22),0_20px_80px_-50px_rgba(255,90,95,0.45)]" : "",
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[#060709]">
        <div className="pointer-events-none absolute inset-0 grid-lines opacity-20" />

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
            <div className="absolute inset-5 rounded-lg border border-dashed border-white/[0.07]" />
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-[#0C0E13]">
              {capture.starting ? (
                <Loader2 className="h-6 w-6 animate-spin text-lime" />
              ) : (
                <Camera className="h-6 w-6 text-faint" />
              )}
            </span>
            <p className="mt-4 text-[16px] font-medium text-ink">
              {capture.starting ? "Opening the camera…" : "The stage is dark."}
            </p>
            <p className="mt-1.5 max-w-xs text-[11.5px] leading-relaxed text-faint">
              Enable the camera or share a screen. The preview is local until you go on air.
            </p>
            <button
              type="button"
              onClick={() => void capture.start()}
              disabled={capture.starting}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-lime px-4 text-[12px] font-medium text-[#0A0B0D] transition hover:bg-[#d6ff57] disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" />
              Enable camera
            </button>
            <button
              type="button"
              onClick={onScreen}
              className="mt-2 inline-flex items-center gap-1.5 text-[10.5px] text-faint transition hover:text-muted"
            >
              <MonitorUp className="h-3 w-3" />
              or share a screen
            </button>
          </div>
        )}

        {videoOff ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#060709]/95 text-center">
            <VideoOff className="h-6 w-6 text-faint" />
            <p className="mt-3 text-[13px] font-medium text-ink">
              {capture.screen ? "Screen share is hidden" : "Camera is off"}
            </p>
            <button
              type="button"
              onClick={capture.toggleCamera}
              className="mt-3 rounded-md border border-line bg-raised px-3 py-1.5 text-[11px] text-muted transition hover:text-ink"
            >
              Turn video back on
            </button>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-4 rounded border border-dashed border-white/[0.12] sm:inset-6" />

        <div className="absolute left-3.5 top-3.5 flex flex-wrap items-center gap-2">
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-live/35 bg-live/15 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-live" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
              </span>
              On air
            </span>
          ) : (
            <span className="rounded-full border border-white/15 bg-black/45 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/65 backdrop-blur">
              Preview
            </span>
          )}
          {recording ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-live/25 bg-black/45 px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-live-soft backdrop-blur">
              <Disc className="h-2.5 w-2.5" />
              Rec
            </span>
          ) : null}
          {capture.screen ? (
            <span className="rounded-full border border-info/25 bg-info/10 px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-info backdrop-blur">
              Screen
            </span>
          ) : null}
        </div>

        <div className="absolute right-3.5 top-3.5 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.12em] backdrop-blur",
              connected
                ? "border-ok/25 bg-ok/10 text-ok"
                : failed
                  ? "border-live/25 bg-live/10 text-live-soft"
                  : "border-white/15 bg-black/45 text-white/65",
            )}
          >
            {connected ? <Wifi className="h-2.5 w-2.5" /> : failed ? <WifiOff className="h-2.5 w-2.5" /> : <Radio className="h-2.5 w-2.5" />}
            {connected ? "WHIP live" : failed ? "WHIP lost" : publishing ? "Connecting" : "Not publishing"}
          </span>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/75 to-transparent" />

        <div className="absolute inset-x-3.5 bottom-3 flex items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur",
                capture.micOn
                  ? "border-white/15 bg-black/45 text-white/80"
                  : "border-live/30 bg-live/15 text-live-soft",
              )}
            >
              {capture.micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            </span>
            <div className="flex h-5 items-end gap-[2px]">
              {Array.from({ length: 18 }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "w-[3px] rounded-full transition-all",
                    capture.micOn && capture.level > (index / 18) * 100
                      ? index > 14
                        ? "bg-live"
                        : index > 10
                          ? "bg-warn"
                          : "bg-ok"
                      : "bg-white/15",
                  )}
                  style={{
                    height: `${5 + (capture.micOn && capture.level > (index / 18) * 100 ? 9 : 2)}px`,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-white/50">
            <span>
              {capture.width}×{capture.height}
            </span>
            <span className="h-2.5 w-px bg-white/15" />
            <span>{Math.round(fps ?? capture.frameRate)} fps</span>
            <span className="h-2.5 w-px bg-white/15" />
            <span>{capture.screen ? "screen" : "camera"}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-[#0B0D12] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.08em]">
          <span className="inline-flex items-center gap-1.5 text-faint">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? "bg-ok" : failed ? "bg-live" : publishing ? "bg-warn" : "bg-faint",
              )}
            />
            {connected ? "encoder connected" : failed ? "connection lost" : publishing ? "handshaking" : "idle"}
          </span>
          <span className="text-faint">
            enc <span className="text-muted">{bitrate !== null ? bitrate.toFixed(1) : "—"}</span> Mbps
          </span>
          <span className="text-faint">
            encode <span className="text-muted">{fps !== null ? Math.round(fps) : "—"}</span> fps
          </span>
          {rtt !== null ? (
            <span className="text-faint">
              rtt <span className="text-muted">{Math.round(rtt * 1000)}</span> ms
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint/70">
          h.264 · opus · 720p
        </span>
      </div>

      {capture.error ? (
        <div className="flex items-start gap-2 border-t border-warn/20 bg-warn/5 px-4 py-2.5 text-[11px] leading-relaxed text-warn">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {capture.error}
        </div>
      ) : null}
    </div>
  );
}
