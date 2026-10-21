"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  Gauge,
  Layers,
  Radio,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge, buttonClass, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { SceneVisual } from "./SceneVisual";
import { Simulator } from "./Simulator";

const scenes = [
  {
    short: "Publish",
    kicker: "01 / Publish",
    tag: "WHIP",
    title: "One camera. One origin.",
    body: "The studio captures 720p30 in the browser and publishes it over WHIP. MediaMTX accepts the stream and starts packaging immediately. No transcoder, no GPU, no cloud ingest.",
    specs: ["H.264 720p30", "~2.5 Mbps", "Opus 96k", "one uplink"],
    stat: { label: "Glass-to-origin", value: "~120 ms" },
  },
  {
    short: "Package",
    kicker: "02 / Package",
    tag: "LL-HLS",
    title: "Live video, cut into seconds.",
    body: "The stream becomes 400 ms fMP4 parts inside a one-second segment. Every part has a URL, a sequence, and a SHA-256 hash. The edge proxy signs the playlist and meters every byte.",
    specs: ["400 ms parts", "1 s segments", "signed playlist", "SHA-256"],
    stat: { label: "Live latency", value: "2–4 s" },
  },
  {
    short: "Swarm",
    kicker: "03 / Swarm",
    tag: "TOPOLOGY",
    title: "The audience becomes the network.",
    body: "The coordinator builds a tree: up to three origin seeds, four children per peer, and a maximum depth of four. New viewers join at the live edge instead of starting from scratch.",
    specs: ["4 children / peer", "max depth 4", "origin seeds 3", "STUN only"],
    stat: { label: "Theoretical fan-out", value: "3 × 4⁴" },
  },
  {
    short: "Relay",
    kicker: "04 / Relay",
    tag: "WEBRTC",
    title: "Pieces travel sideways.",
    body: "Viewers request each part from peers first, using chunked WebRTC data channels. The origin serves only seeds, misses, and rebalances. Offload climbs as the room fills.",
    specs: ["16 KB chunks", "2 s peer deadline", "have gossip", "origin guard"],
    stat: { label: "Offload at 20 viewers", value: "≈ 70%" },
  },
  {
    short: "Heal",
    kicker: "05 / Heal",
    tag: "CHURN",
    title: "Churn is normal.",
    body: "When a peer leaves, its children re-parent within one part interval. A missed deadline falls back to origin instantly. The tree is allowed to be imperfect; playback is not.",
    specs: ["re-parent < 400 ms", "no TURN", "deadline 2 s", "fallback first"],
    stat: { label: "Recovery target", value: "< 1 part" },
  },
  {
    short: "Fallback",
    kicker: "06 / Fallback",
    tag: "SAFETY NET",
    title: "The safety net is the point.",
    body: "P2P never blocks playback. Every part has an origin path, every transfer is hash-checked, and the interface tells you when the room is origin-only. A broken swarm is a slower stream, not a dead one.",
    specs: ["hash verified", "origin fallback", "honest metrics", "no lock-in"],
    stat: { label: "Availability", value: "origin ≥ P2P" },
  },
];

const limits = [
  {
    icon: ShieldCheck,
    title: "No TURN in v1",
    body: "Symmetric NAT pairs fail and fall back to origin. That is a deliberate trade: no relay bill, no hidden dependency. The UI labels it clearly.",
  },
  {
    icon: Layers,
    title: "One rendition",
    body: "720p only. No ABR ladder, no transcoding, no per-viewer quality menu. One stream keeps the local box quiet and the swarm simple.",
  },
  {
    icon: Gauge,
    title: "Honest numbers",
    body: "The studio reports origin Mbps against a 12 Mbps guard, connected peers, and health. If the room outgrows the box, it says so instead of hiding it.",
  },
];

export function HowItWorksClient() {
  const [active, setActive] = useState(0);
  const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = Number(visible.target.getAttribute("data-scene"));
        if (Number.isFinite(index)) setActive(index);
      },
      { rootMargin: "-32% 0px -46% 0px", threshold: [0, 0.2, 0.5, 1] },
    );
    for (const section of sectionRefs.current) {
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  function scrollToScene(index: number) {
    sectionRefs.current[index]?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
  }

  const scene = scenes[active] ?? scenes[0]!;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 grid-lines grid-fade opacity-50" />
        <div className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[780px] rounded-full bg-[radial-gradient(closest-side,rgba(201,247,58,0.075),transparent)]" />
        <div className="relative mx-auto grid w-full max-w-[1320px] items-center gap-14 px-5 py-16 lg:grid-cols-[1.02fr_0.98fr] lg:px-8 lg:py-24">
          <div>
            <SectionLabel>Under the hood</SectionLabel>
            <h1 className="mt-6 text-[46px] leading-[0.95] tracking-[-0.045em] sm:text-[58px] lg:text-[66px]">
              Live video that
              <br />
              <span className="text-gradient-lime">travels light.</span>
            </h1>
            <p className="mt-6 max-w-[520px] text-[14.5px] leading-[1.7] text-muted">
              A stream is not a pipe. It is a sequence of tiny, verifiable pieces. MeshStream moves
              those pieces through the audience — and keeps a clean path back to origin for every
              one of them.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#simulator" className={buttonClass("primary", "lg")}>
                <Sparkles className="h-4 w-4" />
                Try the simulator
              </a>
              <Link href="/studio" className={buttonClass("secondary", "lg")}>
                <Radio className="h-4 w-4 text-lime" />
                Open the studio
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-faint">
              {["6 animated scenes", "interactive tree model", "no sign-up"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-lime/70" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="panel noise relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-ok" />
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
                    Edge / LL-HLS
                  </span>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                  GET · 200
                </span>
              </div>
              <div className="space-y-3 p-5 font-mono text-[11px] leading-relaxed">
                <div className="text-faint">
                  <span className="text-lime">GET</span> /hls/live/8f2a/index.m3u8
                </div>
                <div className="rounded-md border border-line bg-[#080A0D] p-3.5 text-[10.5px] leading-[1.9]">
                  <div className="text-faint">#EXTM3U</div>
                  <div className="text-faint">#EXT-X-VERSION:9</div>
                  <div className="text-faint">
                    #EXT-X-PART:DURATION=0.4,URI=<span className="text-lime">&quot;part-1042.mp4&quot;</span>
                  </div>
                  <div className="text-faint">
                    #EXT-X-PART:DURATION=0.4,URI=<span className="text-lime">&quot;part-1043.mp4&quot;</span>
                  </div>
                  <div className="text-muted">
                    sha256 <span className="text-ink">8f2a…c19d</span>{" "}
                    <span className="text-ok">verified</span>
                  </div>
                  <div className="text-faint">
                    #EXT-X-PRELOAD-HINT:URI=<span className="text-lime">&quot;part-1044.mp4&quot;</span>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border border-lime/20 bg-lime/[0.04] px-3 py-2">
                  <span className="text-[9.5px] uppercase tracking-[0.12em] text-lime/80">
                    Peer availability
                  </span>
                  <span className="text-[10px] text-lime">68%</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[9px] uppercase tracking-[0.08em] text-faint">
                  <span>400 ms parts</span>
                  <span>1 s segments</span>
                  <span className="text-right">signed</span>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-4 hidden rounded-lg border border-line bg-[#0B0D12]/95 px-3.5 py-2.5 shadow-xl backdrop-blur sm:block">
              <div className="mono-label mb-1">Origin guard</div>
              <div className="flex items-center gap-2">
                <span className="metric text-[14px] text-ink">4.2</span>
                <span className="text-[10px] text-faint">/ 12 Mbps</span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                  <span className="block h-full w-[35%] rounded-full bg-lime" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1320px] px-5 py-20 lg:px-8">
        <div className="max-w-2xl">
          <SectionLabel>The life of a part</SectionLabel>
          <h2 className="mt-4 text-[32px] tracking-[-0.04em] sm:text-[42px]">
            Follow one piece of video.
          </h2>
          <p className="mt-4 text-[13px] leading-[1.7] text-muted">
            Scroll the sequence, or jump to a scene. The diagram on the left is the same model the
            app uses: an origin, a tree, and a fallback path that is always available.
          </p>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="hidden lg:block">
            <div className="sticky top-[86px]">
              <div className="panel noise overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">
                      Scene {String(active + 1).padStart(2, "0")} / 06
                    </span>
                    <span className="h-3 w-px bg-line" />
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-lime/80">
                      {scene.tag}
                    </span>
                  </div>
                  <Badge tone="lime">{scene.short}</Badge>
                </div>

                <div className="relative aspect-[680/440] w-full overflow-hidden bg-[#090B0E]">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={active}
                      initial={reduce ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0, y: -8 }}
                      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                      className="absolute inset-0"
                    >
                      <SceneVisual scene={active} />
                    </motion.div>
                  </AnimatePresence>
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(7,8,10,0.55))]" />
                </div>

                <div className="flex items-end justify-between gap-4 border-t border-line px-5 py-4">
                  <div>
                    <div className="mono-label mb-1">{scene.stat.label}</div>
                    <div className="metric text-[17px] text-lime">{scene.stat.value}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {scene.specs.map((spec) => (
                      <span
                        key={spec}
                        className="rounded border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9px] text-faint"
                      >
                        {spec}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-6 gap-2">
                {scenes.map((item, index) => (
                  <button
                    key={item.short}
                    type="button"
                    onClick={() => scrollToScene(index)}
                    className={cn(
                      "border-t-2 pt-2 text-left transition",
                      index === active
                        ? "border-lime text-ink"
                        : "border-line text-faint hover:border-line-strong hover:text-muted",
                    )}
                    aria-label={`Jump to scene ${index + 1}: ${item.short}`}
                  >
                    <span className="block font-mono text-[8.5px] tracking-[0.1em]">
                      0{index + 1}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px]">{item.short}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            {scenes.map((item, index) => (
              <div
                key={item.short}
                data-scene={index}
                ref={(element) => {
                  sectionRefs.current[index] = element;
                }}
                className="flex min-h-[62vh] flex-col justify-center border-b border-line/70 py-12 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] tracking-[0.16em] text-lime/70">
                    {item.kicker}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
                    {item.tag}
                  </span>
                </div>
                <h3 className="mt-5 max-w-md text-[28px] tracking-[-0.035em] sm:text-[34px]">
                  {item.title}
                </h3>
                <p className="mt-4 max-w-md text-[13px] leading-[1.75] text-muted">{item.body}</p>

                <div className="mt-6 flex flex-wrap gap-1.5">
                  {item.specs.map((spec) => (
                    <span
                      key={spec}
                      className="rounded border border-line bg-white/[0.02] px-2 py-1 font-mono text-[9.5px] text-faint"
                    >
                      {spec}
                    </span>
                  ))}
                </div>

                <div className="mt-7 flex items-center justify-between border-t border-line/70 pt-4">
                  <span className="mono-label">{item.stat.label}</span>
                  <span className="metric text-[14px] text-lime">{item.stat.value}</span>
                </div>

                <div className="mt-8 overflow-hidden rounded-xl border border-line bg-[#090B0E] lg:hidden">
                  <div className="aspect-[680/440] w-full">
                    <SceneVisual scene={index} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="simulator" className="border-y border-line bg-[#090B0E]">
        <div className="mx-auto w-full max-w-[1320px] px-5 py-20 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <SectionLabel>Break it on purpose</SectionLabel>
              <h2 className="mt-4 text-[32px] tracking-[-0.04em] sm:text-[42px]">
                A tree is only useful
                <br />
                if it heals.
              </h2>
            </div>
            <p className="max-w-xl text-[13px] leading-[1.75] text-muted lg:justify-self-end">
              Change the room size, cut peer delivery, throttle the uplink, or disconnect a viewer.
              The model shows what the origin would carry — and why the guard exists. Every failed
              edge has an origin path.
            </p>
          </div>
          <div className="mt-10">
            <Simulator />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1320px] px-5 py-20 lg:px-8">
        <div className="max-w-2xl">
          <SectionLabel>What v1 does not do</SectionLabel>
          <h2 className="mt-4 text-[32px] tracking-[-0.04em] sm:text-[40px]">
            Small on purpose.
          </h2>
          <p className="mt-4 text-[13px] leading-[1.7] text-muted">
            The interesting part of a peer-assisted system is not pretending every connection
            works. It is designing the failure path first, then making the happy path cheap.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {limits.map((limit) => (
            <div key={limit.title} className="rounded-xl border border-line bg-[#0C0E13] p-6">
              <limit.icon className="h-4 w-4 text-lime/70" />
              <h3 className="mt-6 font-display text-[18px] text-ink">{limit.title}</h3>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">{limit.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-xl border border-lime/20 bg-[#0B0E08] p-7 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-lime/70">
              <TriangleAlert className="h-3 w-3" />
              Ready to see it with a real camera?
            </div>
            <div className="mt-2 font-display text-[24px] text-ink">
              The studio is one link away.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/studio" className={buttonClass("primary", "md")}>
              <Radio className="h-3.5 w-3.5" />
              Go live
            </Link>
            <Link href="/" className={buttonClass("secondary", "md")}>
              Back home
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
