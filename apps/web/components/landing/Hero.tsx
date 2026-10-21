import Link from "next/link";
import { ArrowRight, Check, Radio, Waves } from "lucide-react";
import { Badge } from "@/components/ui";
import { buttonClass } from "@/components/ui/buttonClass";
import { cn } from "@/lib/cn";
import { MeshField } from "./MeshField";

const stats = [
  { value: "720p", label: "Browser studio", detail: "H.264 · 30 fps" },
  { value: "2.5", label: "Mbps target", detail: "No transcoding" },
  { value: "≤ 4 s", label: "Glass-to-glass", detail: "LL-HLS · 400 ms parts" },
  { value: "60%+", label: "Peer offload", detail: "At 20+ viewers" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="pointer-events-none absolute inset-0 grid-lines grid-fade opacity-50" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(201,247,58,0.07),transparent)]" />
      <div className="relative mx-auto w-full max-w-[1320px] px-5 pb-10 pt-14 lg:px-8 lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.03fr_0.97fr] lg:gap-10">
          <div className="max-w-[620px]">
            <div className="flex items-center gap-3">
              <span className="flex h-6 items-center gap-2 rounded-full border border-lime/25 bg-lime/[0.06] px-2.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute h-full w-full animate-ping-soft rounded-full bg-lime" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-lime" />
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-lime">
                  Peer-assisted live
                </span>
              </span>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-faint sm:block">
                No account required
              </span>
            </div>

            <h1 className="mt-6 text-[46px] leading-[0.95] tracking-[-0.045em] sm:text-[58px] lg:text-[66px] xl:text-[74px]">
              The audience
              <br />
              is the <span className="text-gradient-lime">network.</span>
            </h1>

            <p className="mt-6 max-w-[510px] text-[14.5px] leading-[1.65] text-muted">
              Go live from your browser. Viewers watch in 720p and quietly relay the video to each
              other over WebRTC — so one small machine can carry a room without a CDN bill.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/studio" className={buttonClass("primary", "lg", "group")}>
                <Radio className="h-4 w-4" />
                Start a stream
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link href="/how-it-works" className={buttonClass("secondary", "lg")}>
                <Waves className="h-4 w-4 text-lime" />
                Watch it work
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-faint">
              {["No sign-up", "Guest identity", "Runs on one machine"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-lime/80" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute -inset-6 rounded-[28px] bg-[radial-gradient(closest-side,rgba(201,247,58,0.05),transparent)]" />
            <div className="panel noise relative overflow-hidden rounded-xl">
              <div className="flex h-10 items-center justify-between border-b border-line px-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-live" />
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
                    Swarm / live
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9.5px] tracking-[0.08em] text-faint">12 PEERS</span>
                  <Badge tone="live">Live</Badge>
                </div>
              </div>
              <div className="relative aspect-[720/460] w-full">
                <MeshField />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0A0C10] to-transparent" />
              </div>
              <div className="grid grid-cols-3 divide-x divide-line border-t border-line bg-[#0A0C10]">
                {[
                  { label: "Offload", value: "68%", tone: "text-lime" },
                  { label: "Latency", value: "2.8 s", tone: "text-ink" },
                  { label: "Origin", value: "4.2 / 12", tone: "text-muted" },
                ].map((item) => (
                  <div key={item.label} className="px-4 py-3">
                    <div className="mono-label mb-1">{item.label}</div>
                    <div className={`metric text-[15px] ${item.tone}`}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-3 left-4 right-4 flex items-center justify-between rounded-lg border border-line bg-[#0B0D12]/95 px-3 py-2 backdrop-blur">
              <span className="flex items-center gap-2 text-[10.5px] text-faint">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-ok" />
                Direct WebRTC · no TURN
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
                encrypted
              </span>
            </div>
          </div>
        </div>

        <div className="mt-16 grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-[#0A0C10] md:grid-cols-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={cn(
                "border-line px-5 py-4",
                index % 2 === 1 && "border-l",
                index >= 2 && "max-md:border-t",
                index > 0 && "md:border-l",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="metric text-[20px] text-ink">{stat.value}</span>
                <span className="text-[10px] uppercase tracking-[0.1em] text-faint">{stat.label}</span>
              </div>
              <div className="mt-1 text-[10.5px] text-faint/80">{stat.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
