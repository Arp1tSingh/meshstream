"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Signal,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import type { Guest, PlaybackInfo, SwarmStats } from "@meshstream/protocol";
import type { SwarmPeerInfo } from "@meshstream/swarm";
import { SwarmClient } from "@meshstream/swarm";
import { createMeshFragmentLoader } from "@/lib/hlsLoader";
import { api, getApiBase, getSignalBase, resolveApiPath } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface PlaybackMetrics {
  latency: number | null;
  buffer: number;
  bitrate: number | null;
  history: number[];
}

type PlayerState = "loading" | "ready" | "offline" | "error" | "unsupported";

export function Player({
  streamId,
  guest,
  onMetrics,
  onSwarmStats,
  onPeers,
}: {
  streamId: string;
  guest: Guest | null;
  onMetrics: (metrics: PlaybackMetrics) => void;
  onSwarmStats: (stats: SwarmStats) => void;
  onPeers: (peers: SwarmPeerInfo[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const swarmRef = useRef<SwarmClient | null>(null);
  const callbacks = useRef({ onMetrics, onSwarmStats, onPeers });
  callbacks.current = { onMetrics, onSwarmStats, onPeers };

  const [state, setState] = useState<PlayerState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.85);
  const [fullscreen, setFullscreen] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [usingPeers, setUsingPeers] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [buffer, setBuffer] = useState(0);
  const [bitrate, setBitrate] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let hls: Hls | null = null;
    let swarm: SwarmClient | null = null;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let recoveries = 0;
    let whep: RTCPeerConnection | null = null;
    let fallbackStarted = false;
    const history: number[] = [];

    setState("loading");
    setError(null);
    setNeedsGesture(false);

    const waitForIceGathering = (pc: RTCPeerConnection) =>
      new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
          return;
        }
        const finish = () => {
          pc.removeEventListener("icegatheringstatechange", onChange);
          resolve();
        };
        const onChange = () => {
          if (pc.iceGatheringState === "complete") finish();
        };
        pc.addEventListener("icegatheringstatechange", onChange);
        window.setTimeout(finish, 3000);
      });

    // LL-HLS is the normal path, but a lossy publisher link can make
    // MediaMTX's HLS muxer reject reordered H.264 frames. If that happens,
    // switch the viewer to a direct WHEP connection instead of dropping the
    // live edge entirely.
    const startWhepFallback = async () => {
      if (disposed || fallbackStarted) return;
      fallbackStarted = true;
      setError(null);
      setState("loading");
      setUsingPeers(false);
      hls?.destroy();
      hlsRef.current = null;
      swarm?.destroy();
      swarm = null;
      swarmRef.current = null;

      const video = videoRef.current;
      if (!video) return;

      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" },
          ],
        });
        whep = pc;

        const remote = new MediaStream();
        pc.ontrack = (event) => {
          if (event.streams[0]) {
            video.srcObject = event.streams[0];
          } else {
            remote.addTrack(event.track);
            video.srcObject = remote;
          }
          setState("ready");
          void video
            .play()
            .then(() => setPlaying(true))
            .catch(() => setNeedsGesture(true));
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") {
            setError("The direct WebRTC fallback could not connect.");
            setState("error");
          }
        };

        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);

        const response = await fetch(`/webrtc/live/${streamId}/whep`, {
          method: "POST",
          headers: { "content-type": "application/sdp" },
          body: pc.localDescription?.sdp ?? offer.sdp,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`direct media fallback failed (${response.status})`);
        }
        const answer = await response.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        setState("ready");
      } catch (caught) {
        if (disposed) return;
        const message =
          caught instanceof Error ? caught.message : "The live edge is not reachable.";
        setError(message);
        setState("error");
      }
    };

    const boot = async () => {
      if (!guest) return;
      try {
        const playback = await api<PlaybackInfo>(`/api/streams/${streamId}/playback`);
        if (disposed) return;
        if (playback.state !== "live") {
          setState("offline");
          return;
        }

        const p2pAllowed =
          playback.p2p &&
          (typeof window === "undefined" ||
            window.localStorage.getItem("meshstream:p2p") !== "false");

        if (p2pAllowed) {
          swarm = new SwarmClient({
            streamId,
            guestId: guest.id,
            displayName: guest.displayName,
            color: guest.color,
            signalUrl: getSignalBase(),
            apiBase: getApiBase(),
            onStats: (stats) => {
              if (disposed) return;
              setUsingPeers(stats.status === "connected");
              callbacks.current.onSwarmStats(stats);
            },
            onPeers: (peers) => {
              if (!disposed) callbacks.current.onPeers(peers);
            },
            onError: () => {
              // The origin path continues even if the swarm cannot connect.
            },
          });
          swarm.start();
          swarmRef.current = swarm;
        }

        const video = videoRef.current;
        if (!video) return;
        const source = resolveApiPath(playback.hlsPath);

        if (Hls.isSupported()) {
          const MeshFragmentLoader = createMeshFragmentLoader(swarm);
          hls = new Hls({
            lowLatencyMode: true,
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 8,
            maxLiveSyncPlaybackRate: 1.5,
            backBufferLength: 30,
            enableWorker: true,
            fLoader: MeshFragmentLoader,
          });
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (disposed) return;
            setState("ready");
            void video
              .play()
              .then(() => setPlaying(true))
              .catch(() => setNeedsGesture(true));
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || disposed || fallbackStarted) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              recoveries += 1;
              if (recoveries <= 2) {
                hls?.startLoad();
                return;
              }
              void startWhepFallback();
              return;
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              recoveries += 1;
              if (recoveries <= 2) {
                hls?.recoverMediaError();
                return;
              }
              void startWhepFallback();
              return;
            }
            setError("This browser could not start the stream.");
            setState("error");
          });

          hls.attachMedia(video);
          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            hls?.loadSource(source);
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = source;
          setState("ready");
          void video.play().catch(() => setNeedsGesture(true));
        } else {
          setState("unsupported");
          return;
        }

        statsTimer = setInterval(() => {
          if (disposed) return;
          const element = videoRef.current;
          if (!element) return;

          const liveLatency =
            hls && Number.isFinite(hls.latency) && hls.latency > 0
              ? hls.latency
              : hls && hls.liveSyncPosition
                ? Math.max(0, hls.liveSyncPosition - element.currentTime)
                : null;

          let buffered = 0;
          for (let index = 0; index < element.buffered.length; index += 1) {
            const start = element.buffered.start(index);
            const end = element.buffered.end(index);
            if (element.currentTime >= start - 0.5 && element.currentTime <= end + 0.5) {
              buffered = Math.max(0, end - element.currentTime);
            }
          }

          const level = hls?.levels[hls.currentLevel];
          const currentBitrate =
            level?.bitrate ??
            (playback.state === "live" ? 2_500_000 : null);

          const mbps = currentBitrate ? currentBitrate / 1_000_000 : 0;
          history.push(mbps);
          if (history.length > 32) history.shift();

          setLatency(liveLatency);
          setBuffer(buffered);
          setBitrate(currentBitrate);
          callbacks.current.onMetrics({
            latency: liveLatency,
            buffer: buffered,
            bitrate: currentBitrate,
            history: [...history],
          });

          if (swarm) {
            // LL-HLS keeps only a small live buffer, so the old >12s guard
            // prevented peers from ever serving. Any healthy, playing viewer
            // with the requested part in cache can serve it, including a
            // background tab. The swarm still falls back to origin on misses.
            swarm.setServing(buffered > 0.5 && element.readyState >= 2);
          }
        }, 1000);
      } catch (caught) {
        if (disposed) return;
        const message =
          caught instanceof Error ? caught.message : "The player could not connect.";
        setError(message);
        setState("error");
      }
    };

    void boot();

    return () => {
      disposed = true;
      if (statsTimer) clearInterval(statsTimer);
      hls?.destroy();
      hlsRef.current = null;
      whep?.close();
      whep = null;
      swarm?.destroy();
      swarmRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [streamId, guest?.id, attempt]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = muted;
      video.volume = volume;
    }
  }, [muted, volume]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setMuted(false);
      void video.play().catch(() => setNeedsGesture(true));
    } else {
      video.pause();
    }
  }, []);

  const seekToLive = useCallback(() => {
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!hls || !video) return;
    const livePosition = hls.liveSyncPosition;
    if (typeof livePosition === "number" && Number.isFinite(livePosition)) {
      video.currentTime = Math.max(0, livePosition);
      void video.play().catch(() => undefined);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void container.requestFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const pip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // PiP can be blocked by the browser; no need to surface it.
    }
  }, []);

  const retry = () => {
    setAttempt((value) => value + 1);
  };

  const latencyTone =
    latency === null ? "text-faint" : latency > 6 ? "text-warn" : "text-lime";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        if (event.key === " " || event.key === "k") {
          event.preventDefault();
          togglePlay();
        } else if (event.key === "f") {
          toggleFullscreen();
        } else if (event.key === "m") {
          setMuted((value) => !value);
        }
      }}
      className="group relative aspect-video w-full select-none overflow-hidden rounded-xl border border-line bg-black outline-none focus-visible:ring-2 focus-visible:ring-lime/50"
    >
      <video
        ref={videoRef}
        playsInline
        muted={muted}
        onPlay={() => {
          setPlaying(true);
          setNeedsGesture(false);
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onVolumeChange={() => {
          const video = videoRef.current;
          if (!video) return;
          setMuted(video.muted);
          setVolume(video.volume);
        }}
        onDoubleClick={toggleFullscreen}
        className="h-full w-full bg-black object-contain"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-live/35 bg-live/15 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-live" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
          </span>
          Live
        </span>
        <span className="rounded-full border border-white/15 bg-black/40 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/80 backdrop-blur">
          720p
        </span>
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] backdrop-blur",
            usingPeers
              ? "border-lime/35 bg-lime/10 text-lime"
              : "border-white/15 bg-black/40 text-white/70",
          )}
        >
          <Signal className="h-2.5 w-2.5" />
          {usingPeers ? "P2P active" : "Origin"}
        </span>
      </div>

      {state === "loading" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#08090B]">
          <Loader2 className="h-6 w-6 animate-spin text-lime" />
          <div className="text-center">
            <p className="text-[13px] font-medium text-ink">Tuning into the live edge</p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
              signed playlist · 400 ms parts
            </p>
          </div>
        </div>
      ) : null}

      {state === "error" || state === "unsupported" || state === "offline" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#08090B]/95 px-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-raised">
            <WifiOff className="h-5 w-5 text-muted" />
          </span>
          <p className="mt-4 text-[15px] font-medium text-ink">
            {state === "offline"
              ? "This broadcast has ended"
              : state === "unsupported"
                ? "Playback is not supported here"
                : "The player lost the edge"}
          </p>
          <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-muted">
            {state === "offline"
              ? "The host is no longer publishing. Check the library for other live rooms."
              : state === "unsupported"
                ? "Try a recent version of Chrome, Edge, Firefox, or Safari."
                : (error ?? "The stream could not be loaded. Check the media server and retry.")}
          </p>
          {state !== "offline" && state !== "unsupported" ? (
            <button
              type="button"
              onClick={retry}
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-lime px-4 text-[12px] font-medium text-[#0A0B0D] transition hover:bg-[#d6ff57]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry playback
            </button>
          ) : null}
        </div>
      ) : null}

      {buffering && state === "ready" && !needsGesture ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-lime" />
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
              buffering
            </span>
          </div>
        </div>
      ) : null}

      {needsGesture && state === "ready" ? (
        <button
          type="button"
          onClick={() => {
            setMuted(false);
            const video = videoRef.current;
            if (video) void video.play().then(() => setNeedsGesture(false)).catch(() => undefined);
          }}
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px]"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-lime text-[#08090B] shadow-[0_10px_40px_rgba(201,247,58,0.25)] transition hover:scale-105">
            <Play className="ml-1 h-6 w-6 fill-current" />
          </span>
          <span className="mt-4 text-[13px] font-medium text-white">Tap to join the stream</span>
          <span className="mt-1 text-[11px] text-white/60">with sound</span>
        </button>
      ) : null}

      {muted && playing && !needsGesture ? (
        <button
          type="button"
          onClick={() => setMuted(false)}
          className="absolute bottom-20 left-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-[11px] text-white/85 backdrop-blur transition hover:bg-black/75"
        >
          <VolumeX className="h-3.5 w-3.5 text-warn" />
          Sound is off — tap to listen
        </button>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-4">
        <div className="mb-2 flex h-1 w-full items-center gap-[3px]">
          {Array.from({ length: 40 }, (_, index) => (
            <span
              key={index}
              className="h-full flex-1 rounded-full bg-white/15"
              style={{
                background:
                  playing && index < Math.max(1, Math.round((buffer / 30) * 40))
                    ? "rgba(201,247,58,0.55)"
                    : undefined,
              }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-white sm:gap-2.5">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition hover:bg-white/10 hover:text-white"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
          </button>

          <div className="group/vol flex items-center">
            <button
              type="button"
              onClick={() => setMuted((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                setMuted(next === 0);
                const video = videoRef.current;
                if (video) {
                  video.volume = next;
                  video.muted = next === 0;
                }
              }}
              aria-label="Volume"
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/25 opacity-0 transition-all duration-200 group-hover/vol:w-16 group-hover/vol:opacity-100 sm:w-14 sm:opacity-100 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-lime"
            />
          </div>

          <button
            type="button"
            onClick={seekToLive}
            className={cn(
              "ml-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[9px] uppercase tracking-[0.1em] backdrop-blur transition",
              latency !== null && latency > 6
                ? "border-warn/40 bg-warn/15 text-warn hover:bg-warn/25"
                : "border-white/15 bg-black/30 text-white/70 hover:text-white",
            )}
            title="Jump to the live edge"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                latency !== null && latency > 6 ? "bg-warn" : "bg-live",
              )}
            />
            {latency !== null ? `${latency.toFixed(1)}s` : "Live"}
          </button>

          <span className="hidden font-mono text-[9.5px] text-white/45 sm:inline">
            {buffer.toFixed(1)}s buffer
          </span>

          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <span className="hidden items-center gap-1 rounded border border-white/10 bg-black/25 px-1.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-white/55 sm:inline-flex">
              {bitrate ? `${(bitrate / 1_000_000).toFixed(1)} Mbps` : "auto"}
            </span>
            <span className="hidden rounded border border-white/10 bg-black/25 px-1.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-white/55 sm:inline">
              720p
            </span>
            <button
              type="button"
              onClick={() => void pip()}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-white/75 transition hover:bg-white/10 hover:text-white sm:flex"
              aria-label="Picture in picture"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
