"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function mediaErrorMessage(cause: unknown) {
  if (!(cause instanceof Error)) return "Could not start the camera.";
  switch (cause.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera or microphone permission was denied. Allow access in your browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No matching camera or microphone was found on this device.";
    case "NotReadableError":
      return "The camera is busy in another app. Close it and try again.";
    case "AbortError":
      return "The camera took too long to start. Try again.";
    default:
      return cause.message || "Could not start the camera.";
  }
}

export function useMediaCapture() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [level, setLevel] = useState(0);
  const [screen, setScreen] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    stopMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setScreen(false);
    setLevel(0);
  }, [stopMeter]);

  const attachMeter = useCallback((next: MediaStream) => {
    stopMeter();
    const track = next.getAudioTracks()[0];
    if (!track) return;
    try {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(next);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = context;
      void context.resume().catch(() => undefined);
      const data = new Uint8Array(analyser.fftSize);
      let lastLevel = 0;
      let lastAt = 0;

      const tick = () => {
        if (!mountedRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        const next = Math.min(100, Math.round(rms * 260));
        const now = performance.now();
        if (now - lastAt >= 110 && Math.abs(next - lastLevel) >= 1) {
          lastLevel = next;
          lastAt = now;
          setLevel(next);
        }
        meterFrameRef.current = requestAnimationFrame(tick);
      };
      meterFrameRef.current = requestAnimationFrame(tick);
    } catch {
      // Audio metering is cosmetic; capture still works without it.
    }
  }, [stopMeter]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      setCameras(all.filter((device) => device.kind === "videoinput"));
      setMicrophones(all.filter((device) => device.kind === "audioinput"));
    } catch {
      // Device labels may be hidden until permission is granted.
    }
  }, []);

  const start = useCallback(
    async (cameraId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot access the camera. Use a recent browser over HTTPS or localhost.");
        return false;
      }
      setStarting(true);
      setError(null);
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          video: cameraId
            ? {
                deviceId: { exact: cameraId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 },
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 },
                facingMode: "user",
              },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!mountedRef.current) {
          next.getTracks().forEach((track) => track.stop());
          return false;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = next;
        setStream(next);
        setCameraOn(true);
        setMicOn(true);
        setScreen(false);
        const cameraTrack = next.getVideoTracks()[0];
        // Motion-aligned metadata helps the encoder spend bits on moving
        // content (people) instead of static background.
        if (cameraTrack) cameraTrack.contentHint = "motion";
        setActiveCameraId(cameraTrack?.getSettings().deviceId ?? cameraId ?? "");
        attachMeter(next);
        await refreshDevices();
        return true;
      } catch (cause) {
        if (mountedRef.current) setError(mediaErrorMessage(cause));
        return false;
      } finally {
        if (mountedRef.current) setStarting(false);
      }
    },
    [attachMeter, refreshDevices],
  );

  const switchCamera = useCallback(
    async (cameraId: string) => {
      if (!cameraId) return;
      await start(cameraId);
    },
    [start],
  );

  const startScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not available in this browser.");
      return false;
    }
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
      if (!mountedRef.current) {
        display.getTracks().forEach((track) => track.stop());
        return false;
      }
      const audioTracks = streamRef.current?.getAudioTracks() ?? [];
      streamRef.current?.getVideoTracks().forEach((track) => track.stop());
      const mixed = new MediaStream([...display.getVideoTracks(), ...audioTracks]);
      streamRef.current = mixed;
      setStream(mixed);
      setScreen(true);
      setCameraOn(true);
      const videoTrack = display.getVideoTracks()[0];
      // Screen content is text/edges first; hint the encoder accordingly.
      if (videoTrack) videoTrack.contentHint = "detail";
      videoTrack?.addEventListener(
        "ended",
        () => {
          if (!mountedRef.current) return;
          setScreen(false);
          void start();
        },
        { once: true },
      );
      return true;
    } catch (cause) {
      if (mountedRef.current) {
        const message =
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Screen share was cancelled."
            : mediaErrorMessage(cause);
        setError(message);
      }
      return false;
    }
  }, [start]);

  const toggleCamera = useCallback(() => {
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    const next = !cameraOn;
    tracks.forEach((track) => {
      track.enabled = next;
    });
    setCameraOn(next);
  }, [cameraOn]);

  const toggleMic = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    const next = !micOn;
    tracks.forEach((track) => {
      track.enabled = next;
    });
    setMicOn(next);
  }, [micOn]);

  useEffect(() => {
    mountedRef.current = true;
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      if (meterFrameRef.current !== null) cancelAnimationFrame(meterFrameRef.current);
      if (audioContextRef.current) void audioContextRef.current.close().catch(() => undefined);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [refreshDevices]);

  const videoTrack = stream?.getVideoTracks()[0];
  const settings = videoTrack?.getSettings();

  return {
    stream,
    starting,
    error,
    cameraOn,
    micOn,
    level,
    screen,
    cameras,
    microphones,
    activeCameraId,
    width: settings?.width ?? 1280,
    height: settings?.height ?? 720,
    frameRate: settings?.frameRate ?? 30,
    start,
    stop,
    switchCamera,
    startScreen,
    toggleCamera,
    toggleMic,
  };
}

export type MediaCaptureController = ReturnType<typeof useMediaCapture>;
