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
import { debugLogSample, logSdpVideoSection } from "@/lib/debugStats";
import { cn } from "@/lib/cn";

export interface PlaybackMetrics {
  latency: number | null;
  buffer: number;
  bitrate: number | null;
  history: number[];
}

type PlayerState = "loading" | "ready" | "offline" | "error" | "unsupported";

// Stuck-attach watchdog deadlines (ms) — how long the player tolerates no
// fragment loading after the manifest parsed, and no playback progress (with
// fragments also gone quiet) while the viewer is meant to be playing.
const WATCHDOG_ATTACH_MS = 12_000;
const WATCHDOG_STALL_MS = 16_000;

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
    let manifestParsed = false;
    // Stuck-attach watchdog state: the phase 4 background-tab drill showed a
    // silent failure mode — the manifest parses, playlists keep reloading,
    // but no fragment is ever fetched and playback never starts, with no
    // fatal hls.js error to trigger the normal recovery path. If either
    // activity signal goes quiet for too long we retry the source once and
    // then hand over to the WHEP fallback.
    let firstFragAt = 0;
    let lastActivityAt = performance.now();
    let lastProgressTime = 0;
    let watchdogRetried = false;
    let whep: RTCPeerConnection | null = null;
    let whepSessionId = "";
    let whepReportTimer: ReturnType<typeof setInterval> | null = null;
    let playbackWhepPath = "";
    let fallbackStarted = false;
    const history: number[] = [];

    // Phase-0 delivery stats, only used for instrumentation.
    let bytesReceived = 0;
    let bytesAtLastSample = 0;
    const statsStart = performance.now();

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

      // Per-session bitrate accounting: the RTP bytes flow peer<->MediaMTX
      // directly, so the viewer reads its own inbound byte counter from
      // pc.getStats() and reports the delta to the API every 10 s. This is
      // also the session heartbeat the API uses to reap dead sessions.
      const startWhepAccounting = (peer: RTCPeerConnection) => {
        let lastBytes = 0;
        let lastAt = 0;
        const report = async () => {
          if (disposed || !whepSessionId) return;
          try {
            const stats = await peer.getStats();
            let bytes = 0;
            stats.forEach((entry) => {
              if (entry.type === "inbound-rtp" && typeof entry.bytesReceived === "number") {
                bytes += entry.bytesReceived;
              }
            });
            const now = Date.now();
            if (lastAt > 0 && bytes > lastBytes) {
              const mbps =
                ((bytes - lastBytes) * 8) / ((now - lastAt) / 1000) / 1_000_000;
              void fetch(resolveApiPath(`/api/streams/${streamId}/whep/report`), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  sessionId: whepSessionId,
                  mbps: Math.round(mbps * 100) / 100,
                }),
                credentials: "include",
              }).catch(() => undefined);
            }
            lastBytes = bytes;
            lastAt = now;
          } catch {
            // keepalive errors are not fatal to playback
          }
        };
        whepReportTimer = setInterval(() => void report(), 10_000);
        void report();
      };

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

        const response = await fetch(
          playbackWhepPath || `/api/streams/${streamId}/whep`,
          {
            method: "POST",
            headers: { "content-type": "application/sdp" },
            body: pc.localDescription?.sdp ?? offer.sdp,
            cache: "no-store",
            credentials: "include",
          },
        );
        if (!response.ok) {
          throw new Error(`direct media fallback failed (${response.status})`);
        }
        const answer = await response.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        logSdpVideoSection("viewer-whep-answer", answer);
        whepSessionId = response.headers.get("x-whep-session-id") ?? "";
        if (whepSessionId) {
          startWhepAccounting(pc);
        } else {
          debugLogSample("player", { event: "whep-session-missing" });
        }
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
        playbackWhepPath = playback.whepPath ?? "";
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

        // Watchdog helper: a stall is either "manifest parsed but no
        // fragment ever loaded" (silent attach stall, measured up to 60 s
        // in background tabs) or "fragments stopped and the playhead is
        // not moving while the player is supposed to be playing". Pausing
        // the video is legitimate no-progress and must not escalate.
        const watchdogStalled = () => {
          const idleMs = performance.now() - lastActivityAt;
          const attachStalled = !firstFragAt && idleMs > WATCHDOG_ATTACH_MS;
          const playbackStalled = !video.paused && idleMs > WATCHDOG_STALL_MS;
          return attachStalled || playbackStalled ? idleMs : 0;
        };

        if (Hls.isSupported()) {
          const MeshFragmentLoader = createMeshFragmentLoader(swarm);
          hls = new Hls({
            lowLatencyMode: true,
            // One segment behind the edge (LL-HLS parts keep it smooth). With
            // the playlist's reported target duration this lands ~2 s behind
            // the publisher; the previous value of 2 measured at ~4.1 s.
            liveSyncDurationCount: 1,
            liveMaxLatencyDurationCount: 8,
            maxLiveSyncPlaybackRate: 1.5,
            backBufferLength: 30,
            enableWorker: true,
            fLoader: MeshFragmentLoader,
          });
          hlsRef.current = hls;

          // Watchdog helper: a stall is either "manifest parsed but no
          // fragment ever loaded" (silent attach stall, measured up to 60 s
          // in background tabs) or "fragments stopped and the playhead is
          // not moving while the player is supposed to be playing". Both
          // arms need the loopback deadlines below; pausing the video is
          // legitimate no-progress and must not escalate.
          const watchdogStalled = () => {
            const idleMs = performance.now() - lastActivityAt;
            const attachStalled = !firstFragAt && idleMs > WATCHDOG_ATTACH_MS;
            const playing = !videoRef.current?.paused;
            const playbackStalled = playing && idleMs > WATCHDOG_STALL_MS;
            return attachStalled || playbackStalled ? idleMs : 0;
          };

          // hls.js hands every loaded payload through FRAG_LOADED — fragments
          // and LL-HLS parts alike — so this covers swarm and origin paths.
          hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
            const total = Number(data?.payload?.byteLength ?? 0);
            if (Number.isFinite(total) && total > 0) bytesReceived += total;
            if (!firstFragAt) firstFragAt = performance.now();
            lastActivityAt = performance.now();
          });

          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            debugLogSample("hls", { event: "media-attached" });
          });

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (disposed) return;
            manifestParsed = true;
            lastActivityAt = performance.now();
            debugLogSample("hls", {
              event: "manifest",
              levels: hls?.levels?.length ?? 0,
            });
            setState("ready");
            void video
              .play()
              .then(() => setPlaying(true))
              .catch(() => setNeedsGesture(true));
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            debugLogSample("hls", {
              event: "error",
              type: data.type,
              details: data.details,
              fatal: data.fatal,
            });
            if (!data.fatal || disposed || fallbackStarted) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              recoveries += 1;
              if (recoveries <= 2) {
                if (manifestParsed) {
                  hls?.startLoad();
                } else {
                  // A fatal can land before the manifest ever parses, and
                  // startLoad() cannot re-trigger a master manifest load
                  // (only loadSource emits MANIFEST_LOADING in hls.js 1.7;
                  // its own PlaylistLoader.startLoad is a no-op), so the
                  // phase 4 drill showed the retry silently dropping and
                  // the player hanging on the live-edge copy. Restart the
                  // source path instead.
                  hls?.loadSource(source);
                }
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
          // Load the manifest immediately instead of inside MEDIA_ATTACHED:
          // the load does not require media attach (hls.js queues it), and a
          // backgrounded tab can delay internal events — a phase 4 smoke run
          // showed a viewer stuck on "Tuning into the live edge" for the
          // whole session with the event-ordered call.
          hls.loadSource(source);
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

          if (element.currentTime > lastProgressTime + 0.001) {
            lastProgressTime = element.currentTime;
            lastActivityAt = performance.now();
          }

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
          const bwEstimate = hls ? Number(hls.bandwidthEstimate) : 0;
          const bytesPerSecond = bytesReceived - bytesAtLastSample;
          bytesAtLastSample = bytesReceived;
          const measuredFallback = bwEstimate > 0 ? bwEstimate : bytesPerSecond * 8;
          const currentBitrate =
            level?.bitrate ??
            (playback.state === "live" && measuredFallback > 0 ? measuredFallback : null);

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

          // Only meaningful before the WHEP handover and only for the HLS
          // pipeline; a fallback already in progress owns the lane from here.
          if (!fallbackStarted && manifestParsed && playback.state === "live") {
            const stalledMs = watchdogStalled();
            if (stalledMs > 0) {
              if (!watchdogRetried) {
                watchdogRetried = true;
                debugLogSample("player", {
                  event: "watchdog-retry",
                  idleMs: Math.round(stalledMs),
                  firstFrag: Boolean(firstFragAt),
                  readyState: element.readyState,
                });
                // Same restart as the fatal-network path before
                // manifestParsed: startLoad() cannot revive a silently
                // dead pipeline, only loadSource() re-issues the manifest.
                hls?.loadSource(source);
                lastActivityAt = performance.now();
                lastProgressTime = element.currentTime;
              } else {
                debugLogSample("player", {
                  event: "watchdog-fallback",
                  idleMs: Math.round(performance.now() - lastActivityAt),
                });
                void startWhepFallback();
              }
            }
          }

          debugLogSample("player", {
            t: Math.round((performance.now() - statsStart) / 100) / 10,
            levelBitrate: level?.bitrate ?? null,
            levelIndex: hls?.currentLevel ?? null,
            bwEstimateMbps: Math.round(bwEstimate / 1000) / 1000,
            bytesPerSecond,
            bytesReceived,
            latency: liveLatency === null ? null : Math.round(liveLatency * 100) / 100,
            buffered: Math.round(buffered * 100) / 100,
            live: playback.state === "live",
          });

          if (swarm) {
            const swarmStats = swarm.getStats();
            debugLogSample("swarm", {
              status: swarmStats.status,
              peers: swarmStats.peers,
              parent: swarmStats.parent ? swarmStats.parent.slice(0, 8) : null,
              children: swarmStats.children,
              cache: swarmStats.cacheEntries,
              peerKb: Math.round(swarmStats.peerBytes / 1000),
              originKb: Math.round(swarmStats.originBytes / 1000),
              servedKb: Math.round(swarmStats.servedBytes / 1000),
            });
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
      if (whepReportTimer) {
        clearInterval(whepReportTimer);
        whepReportTimer = null;
      }
      if (whep && whepSessionId) {
        // Release the metered API session before tearing down the peer.
        void fetch(
          `${resolveApiPath(`/api/streams/${streamId}/whep`)}?sid=${encodeURIComponent(whepSessionId)}`,
          { method: "DELETE", keepalive: true },
        ).catch(() => undefined);
      }
      whepSessionId = "";
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
