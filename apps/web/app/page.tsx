import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  Cpu,
  Layers,
  Radio,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { Hero } from "@/components/landing/Hero";
import { LiveNow } from "@/components/landing/LiveNow";
import { SectionLabel } from "@/components/ui";
import { buttonClass } from "@/components/ui/buttonClass";

const steps = [
  {
    number: "01",
    icon: Camera,
    title: "Publish",
    tag: "WHIP · 720p",
    body: "Your browser captures 720p30 and sends it to the local media server. No transcoder, no GPU, no cloud ingest.",
  },
  {
    number: "02",
    icon: Layers,
    title: "Slice",
    tag: "LL-HLS · 400 ms",
    body: "MediaMTX cuts the stream into small fMP4 parts and publishes a signed playlist. Every part gets a hash.",
  },
  {
    number: "03",
    icon: Waves,
    title: "Relay",
    tag: "WebRTC · direct",
    body: "Viewers pull parts from each other over data channels. The origin only seeds the swarm and covers misses.",
  },
];

function HowSection() {
  return (
    <section className="border-y border-line bg-[#090B0E]">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-20 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <SectionLabel>The mechanism</SectionLabel>
            <h2 className="mt-4 max-w-lg text-[32px] tracking-[-0.04em] sm:text-[40px]">
              Three moves.
              <br />
              One small origin.
            </h2>
          </div>
          <Link
            href="/how-it-works"
            className="group inline-flex items-center gap-2 text-[12px] text-muted transition hover:text-lime"
          >
            See the full animation
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative overflow-hidden rounded-xl border border-line bg-[#0C0E13] p-6 transition hover:border-line-strong"
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-[10px] tracking-[0.16em] text-faint">
                  {step.number}
                </span>
                <step.icon className="h-4 w-4 text-lime/70" />
              </div>
              <h3 className="mt-8 font-display text-[22px] text-ink">{step.title}</h3>
              <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-lime/60">
                {step.tag}
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-muted">{step.body}</p>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-lime/20 to-transparent opacity-0 transition group-hover:opacity-100" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section className="mx-auto w-full max-w-[1320px] px-5 py-20 lg:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <SectionLabel>Local-first</SectionLabel>
          <h2 className="mt-4 text-[32px] tracking-[-0.04em] sm:text-[40px]">
            One machine can
            <br />
            carry the room.
          </h2>
          <p className="mt-5 max-w-md text-[13px] leading-[1.7] text-muted">
            A 720p passthrough stream costs almost no CPU. The hard part is bandwidth — and that is
            exactly what the swarm is for. The origin guard keeps the home uplink inside its budget
            and tells you when the room outgrows it.
          </p>

          <div className="mt-7 space-y-4">
            {[
              {
                icon: Cpu,
                title: "No transcoding",
                body: "720p in, 720p out. Packaging only, so the server stays quiet.",
              },
              {
                icon: ShieldCheck,
                title: "Honest fallback",
                body: "Every missed part comes from origin. P2P never blocks playback.",
              },
              {
                icon: Radio,
                title: "Free public link",
                body: "A Cloudflare tunnel exposes the local stack over HTTPS and WSS.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-[#0C0E13]">
                  <item.icon className="h-3.5 w-3.5 text-lime/80" />
                </div>
                <div>
                  <div className="text-[12.5px] font-medium text-ink">{item.title}</div>
                  <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{item.body}</div>
                </div>
              </div>
            ))}
          </div>

          <Link
            href="/how-it-works#simulator"
            className="mt-8 inline-flex items-center gap-2 text-[12px] text-lime/80 transition hover:text-lime"
          >
            Try the origin guard in the simulator
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="panel noise relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="mono-label">System / one box</span>
            <span className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              local
            </span>
          </div>
          <div className="grid-lines relative p-5 sm:p-7">
            <svg viewBox="0 0 600 330" className="w-full" role="img" aria-label="Studio publishes to MediaMTX, the edge serves viewers, and viewers relay to each other">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#4A5361" />
                </marker>
              </defs>

              <g fontFamily="var(--font-mono)" fontSize="9" letterSpacing="0.1em">
                <rect x="18" y="30" width="150" height="58" rx="10" fill="#0C0F14" stroke="#2A303B" />
                <text x="34" y="52" fill="#6A7280">STUDIO</text>
                <text x="34" y="70" fill="#ECEEF2" fontSize="11">Browser · 720p</text>

                <rect x="225" y="30" width="150" height="58" rx="10" fill="#0C0F14" stroke="#3A4230" />
                <text x="241" y="52" fill="#6A7280">MEDIAMTX</text>
                <text x="241" y="70" fill="#C9F73A" fontSize="11">WHIP → LL-HLS</text>

                <rect x="432" y="30" width="150" height="58" rx="10" fill="#0C0F14" stroke="#2A303B" />
                <text x="448" y="52" fill="#6A7280">EDGE</text>
                <text x="448" y="70" fill="#ECEEF2" fontSize="11">Caddy · tunnel</text>
              </g>

              <g stroke="#4A5361" strokeWidth="1" markerEnd="url(#arrow)">
                <line x1="168" y1="59" x2="220" y2="59" />
                <line x1="375" y1="59" x2="427" y2="59" />
              </g>
              <text x="174" y="50" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)">WHIP</text>
              <text x="380" y="50" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)">HLS</text>

              <path d="M 507 88 V 138" stroke="#2A303B" strokeDasharray="3 4" />
              <path d="M 507 138 H 105" stroke="#2A303B" strokeDasharray="3 4" />

              {[
                { x: 105, y: 178 },
                { x: 245, y: 178 },
                { x: 385, y: 178 },
                { x: 507, y: 178 },
              ].map(({ x, y }, index) => (
                <g key={index}>
                  <path d={`M ${x} 138 V ${y - 18}`} stroke="#2A303B" strokeDasharray="3 4" />
                  <circle cx={x} cy={y} r="17" fill="#0D1015" stroke={index === 0 ? "#C9F73A" : "#323947"} />
                  <circle cx={x} cy={y} r="4.5" fill={index === 0 ? "#C9F73A" : "#5B6472"} />
                  <text x={x} y={y + 32} textAnchor="middle" fill="#6A7280" fontSize="8" fontFamily="var(--font-mono)">
                    {index === 0 ? "SEED" : `P${index}`}
                  </text>
                </g>
              ))}

              <g stroke="#C9F73A" strokeOpacity="0.4" strokeWidth="1.2" strokeDasharray="4 5" className="animate-dash">
                <line x1="122" y1="178" x2="228" y2="178" />
                <line x1="262" y1="178" x2="368" y2="178" />
                <line x1="402" y1="178" x2="490" y2="178" />
                <line x1="105" y1="195" x2="245" y2="195" />
              </g>
              <text x="300" y="228" textAnchor="middle" fill="#C9F73A" fontSize="8.5" fontFamily="var(--font-mono)" letterSpacing="0.12em">
                WEBRTC DATA CHANNELS · DIRECT
              </text>

              <g fontFamily="var(--font-mono)" fontSize="9">
                <rect x="18" y="266" width="564" height="42" rx="8" fill="#0A0C10" stroke="#232833" />
                <text x="34" y="285" fill="#6A7280" letterSpacing="0.1em">ORIGIN GUARD</text>
                <rect x="34" y="294" width="300" height="4" rx="2" fill="#1B2028" />
                <rect x="34" y="294" width="112" height="4" rx="2" fill="#C9F73A" />
                <text x="348" y="298" fill="#9AA1AE">4.2 / 12 Mbps</text>
                <text x="488" y="285" fill="#6A7280">BUDGET</text>
                <text x="488" y="298" fill="#ECEEF2">35%</text>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-[1320px] px-5 pb-8 lg:px-8">
      <div className="noise relative overflow-hidden rounded-2xl border border-lime/20 bg-[#0B0E08] px-6 py-14 sm:px-12">
        <div className="pointer-events-none absolute inset-0 grid-lines opacity-50" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(201,247,58,0.14),transparent)]" />
        <div className="relative flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
          <div>
            <div className="mono-label mb-4 text-lime/70">No account · no card · no CDN</div>
            <h2 className="max-w-xl text-[38px] tracking-[-0.045em] sm:text-[52px]">
              Your audience is
              <br />
              the <span className="text-gradient-lime">CDN.</span>
            </h2>
            <p className="mt-5 max-w-lg text-[13px] leading-relaxed text-muted">
              Open the studio, allow your camera, and share one link. MeshStream handles the
              swarm, the fallback, and the honest numbers.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/studio" className={buttonClass("primary", "lg")}>
              <Radio className="h-4 w-4" />
              Go live now
            </Link>
            <Link href="/how-it-works" className={buttonClass("secondary", "lg")}>
              See the machinery
            </Link>
          </div>
        </div>
        <div className="relative mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-lime/10 pt-5 text-[10.5px] text-faint">
          {["720p browser studio", "400 ms LL-HLS parts", "Hash-verified segments", "Origin guard"].map(
            (item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <Check className="h-3 w-3 text-lime/60" />
                {item}
              </span>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main>
        <Hero />
        <LiveNow />
        <HowSection />
        <ArchitectureSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
