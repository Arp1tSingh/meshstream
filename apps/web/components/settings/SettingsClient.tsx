"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clipboard,
  Database,
  HardDrive,
  KeyRound,
  Loader2,
  LockKeyhole,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Wifi,
} from "lucide-react";
import { Avatar, Badge, Button, Switch } from "@/components/ui";
import { useGuest } from "@/components/providers/GuestProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { api, getApiBase, getSignalBase } from "@/lib/api";
import {
  getP2pPreference,
  listHosts,
  removeHost,
  setP2pPreference,
} from "@/lib/hostKey";
import { cn } from "@/lib/cn";

type Health = "checking" | "ok" | "down";

export function SettingsClient() {
  const { guest, loading, openProfile } = useGuest();
  const { toast } = useToast();
  const [p2p, setP2p] = useState(true);
  const [hostCount, setHostCount] = useState(0);
  const [health, setHealth] = useState<Health>("checking");
  const [copied, setCopied] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [version] = useState("0.1.0");

  useEffect(() => {
    setP2p(getP2pPreference());
    setHostCount(listHosts().length);
    void api<{ reachable: boolean }>("/api/media/health")
      .then((data) => setHealth(data.reachable ? "ok" : "down"))
      .catch(() => setHealth("down"));
  }, []);

  function toggleP2p(value: boolean) {
    setP2p(value);
    setP2pPreference(value);
    toast(value ? "Peer-assisted playback enabled" : "Playback is now origin-only");
  }

  function forgetAllHosts() {
    if (!confirmForget) {
      setConfirmForget(true);
      setTimeout(() => setConfirmForget(false), 4000);
      return;
    }
    for (const record of listHosts()) removeHost(record.streamId);
    setHostCount(0);
    setConfirmForget(false);
    toast("All host keys removed from this browser");
  }

  async function copyDiagnostics() {
    const diagnostics = {
      generatedAt: new Date().toISOString(),
      version,
      guest: guest
        ? { id: guest.id, displayName: guest.displayName }
        : null,
      p2p,
      hostKeys: hostCount,
      mediaServer: health,
      apiBase: getApiBase() || "same-origin",
      signalBase: getSignalBase() || "same-origin",
      origin: window.location.origin,
      userAgent: navigator.userAgent,
      language: navigator.language,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopied(true);
      toast("Diagnostics copied", { tone: "success" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Clipboard access was blocked", { tone: "error" });
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1060px] px-5 py-10 lg:px-8 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mono-label flex items-center gap-2">
            <SlidersHorizontal className="h-3 w-3 text-lime/70" />
            Preferences
          </div>
          <h1 className="mt-4 text-[38px] leading-[0.98] tracking-[-0.04em] sm:text-[46px]">
            Settings.
          </h1>
          <p className="mt-4 max-w-xl text-[13px] leading-[1.7] text-muted">
            Everything here lives on this device. MeshStream has no accounts, no email, and no
            server-side profile to manage.
          </p>
        </div>
        <Badge tone="lime">
          <LockKeyhole className="h-3 w-3" />
          local-first
        </Badge>
      </div>

      <div className="mt-10 space-y-5">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <UserRound className="h-4 w-4 text-muted" />
              <span className="text-[12.5px] font-medium text-ink">Guest identity</span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              no account
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 p-5">
            {guest ? (
              <Avatar name={guest.displayName} color={guest.color} size={48} />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-raised text-faint">
                ?
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium text-ink">
                {loading ? "Starting guest session…" : (guest?.displayName ?? "Guest unavailable")}
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
                {guest ? `guest ${guest.id.slice(0, 12)} · this browser` : "no cookie yet"}
              </div>
              <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-faint">
                The guest cookie identifies you for chat and stream ownership. Change the display
                name and color at any time; there is nothing to verify.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={openProfile} disabled={!guest}>
              Edit profile
            </Button>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Network className="h-4 w-4 text-muted" />
              <span className="text-[12.5px] font-medium text-ink">Playback</span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              720p · LL-HLS
            </span>
          </div>

          <div className="divide-y divide-line">
            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">Peer-assisted delivery</div>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-faint">
                  Request parts from nearby viewers before origin. Turning this off makes every
                  request go to origin; chat and host controls are unaffected.
                </p>
              </div>
              <Switch checked={p2p} onCheckedChange={toggleP2p} label={p2p ? "On" : "Off"} />
            </div>

            <div className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-muted">Low-latency mode</div>
                <div className="mt-0.5 text-[10px] text-faint">
                  400 ms parts, live sync, catch-up rate capped at 1.5×.
                </div>
              </div>
              <Badge tone="lime">Always on</Badge>
            </div>

            <div className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-muted">Muted autoplay</div>
                <div className="mt-0.5 text-[10px] text-faint">
                  Players start muted so the browser lets them join the live edge.
                </div>
              </div>
              <Badge tone="neutral">Browser policy</Badge>
            </div>

            <div className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-muted">Origin fallback</div>
                <div className="mt-0.5 text-[10px] text-faint">
                  Every part has a signed origin path. It cannot be disabled.
                </div>
              </div>
              <Badge tone="lime">Always on</Badge>
            </div>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 text-muted" />
              <span className="text-[12.5px] font-medium text-ink">Data on this device</span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              local storage
            </span>
          </div>

          <div className="divide-y divide-line">
            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-[#0A0C10] text-muted">
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">
                  Host keys <span className="ml-1 font-mono text-[10px] text-faint">({hostCount})</span>
                </div>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-faint">
                  Required to open your studios. The server stores only a hash. Losing these keys
                  means losing host control of those rooms.
                </p>
              </div>
              <button
                type="button"
                onClick={forgetAllHosts}
                disabled={hostCount === 0}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[10.5px] transition disabled:opacity-35",
                  confirmForget
                    ? "border-live/35 bg-live/10 text-live-soft"
                    : "border-line text-muted hover:border-live/25 hover:text-live-soft",
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirmForget ? "Confirm forget" : "Forget all"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-[#0A0C10] text-muted">
                <HardDrive className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-ink">Local recordings</div>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-faint">
                  Recordings are written by the browser's download manager, never uploaded. Server
                  recordings (if MediaMTX is configured to record) live under the local data
                  directory.
                </p>
              </div>
              <Link
                href="/library"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[10.5px] text-muted transition hover:border-line-strong hover:text-ink"
              >
                Library
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-[#0A0C10] text-muted">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-muted">Cookies</div>
                <div className="mt-0.5 text-[10px] text-faint">
                  One signed <span className="font-mono">ms_guest</span> cookie, HttpOnly. No
                  analytics or third-party trackers.
                </div>
              </div>
              <Badge tone="neutral">1 cookie</Badge>
            </div>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="flex items-center gap-2.5">
              <Wifi className="h-4 w-4 text-muted" />
              <span className="text-[12.5px] font-medium text-ink">System</span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              v{version}
            </span>
          </div>

          <div className="divide-y divide-line">
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-[140px_1fr] sm:items-center">
              <span className="mono-label">API</span>
              <code className="truncate font-mono text-[11px] text-muted">
                {getApiBase() || "same-origin"}
              </code>
            </div>
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-[140px_1fr] sm:items-center">
              <span className="mono-label">Signal</span>
              <code className="truncate font-mono text-[11px] text-muted">
                {getSignalBase() || "same-origin"}
              </code>
            </div>
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-[140px_1fr] sm:items-center">
              <span className="mono-label">Media server</span>
              <span className="inline-flex items-center gap-2 font-mono text-[11px]">
                {health === "checking" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" />
                    <span className="text-faint">checking…</span>
                  </>
                ) : health === "ok" ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                    <span className="text-ok">MediaMTX reachable</span>
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                    <span className="text-warn">MediaMTX offline</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-muted">Diagnostics bundle</div>
                <div className="mt-0.5 text-[10px] text-faint">
                  Copies your local settings and browser info. No host keys are included.
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void copyDiagnostics()}>
                {copied ? <Check className="h-3.5 w-3.5 text-lime" /> : <Clipboard className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy diagnostics"}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="h-3 w-3 text-lime/60" />
          {hostCount} host key{hostCount === 1 ? "" : "s"} on this device
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Network className="h-3 w-3 text-lime/60" />
          P2P {p2p ? "enabled" : "disabled"}
        </span>
        <Link href="/how-it-works" className="ml-auto inline-flex items-center gap-1.5 transition hover:text-muted">
          How it works
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
    </main>
  );
}
