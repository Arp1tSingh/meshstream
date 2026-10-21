import Link from "next/link";
import { Wordmark } from "./Logo";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/studio", label: "Studio" },
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-[12px] leading-relaxed text-muted">
            Live video that travels light. A peer-assisted streaming experiment you can run on
            one machine.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["WebRTC", "LL-HLS", "Next.js", "SQLite"].map((item) => (
              <span
                key={item}
                className="rounded border border-line bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-faint"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mono-label mb-4">Product</div>
          <ul className="space-y-2.5 text-[12px] text-muted">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="transition hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mono-label mb-4">System</div>
          <ul className="space-y-2.5 text-[12px] text-muted">
            <li>No accounts · guest sessions</li>
            <li>Origin guard · 720p</li>
            <li>Free tunnel · local-first</li>
            <li>
              <Link href="/how-it-works#simulator" className="text-lime/80 transition hover:text-lime">
                Try the swarm simulator →
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line/60">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-2 px-5 py-5 text-[10.5px] text-faint sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} MeshStream · v0.1</span>
          <span className="font-mono">The audience is the network.</span>
        </div>
      </div>
    </footer>
  );
}
