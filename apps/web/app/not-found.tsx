import Link from "next/link";
import { ArrowLeft, Compass, Radio } from "lucide-react";
import { TopNav } from "@/components/site/TopNav";
import { Footer } from "@/components/site/Footer";
import { buttonClass } from "@/components/ui/buttonClass";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="relative mx-auto flex min-h-[68vh] w-full max-w-[1320px] flex-col items-center justify-center overflow-hidden px-5 text-center">
        <div className="pointer-events-none absolute inset-0 grid-lines grid-fade opacity-40" />
        <div className="relative">
          <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-lime/60">
            signal lost · 404
          </div>
          <div className="mt-5 font-display text-[96px] leading-none tracking-[-0.06em] text-ink sm:text-[136px]">
            4<span className="text-lime">0</span>4
          </div>
          <h1 className="mt-3 text-[24px] tracking-[-0.03em] sm:text-[30px]">
            This edge does not exist.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-muted">
            The page may have moved, the room may have ended, or the link was mistyped. The origin
            is still online.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/" className={buttonClass("primary", "md")}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to live
            </Link>
            <Link href="/how-it-works" className={buttonClass("secondary", "md")}>
              <Compass className="h-3.5 w-3.5" />
              How it works
            </Link>
            <Link href="/studio" className={buttonClass("secondary", "md")}>
              <Radio className="h-3.5 w-3.5 text-lime" />
              Open studio
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
