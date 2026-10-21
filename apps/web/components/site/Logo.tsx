import Link from "next/link";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-6 w-6", className)}
      aria-hidden
    >
      <path d="M12 5.2 5.4 17.4h13.2L12 5.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity="0.55" />
      <path d="M12 5.2 5.4 17.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12 5.2 18.6 17.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.4 17.4h13.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="5.2" r="2.1" fill="currentColor" />
      <circle cx="5.4" cy="17.4" r="2.1" fill="currentColor" />
      <circle cx="18.6" cy="17.4" r="2.1" fill="currentColor" />
      <circle cx="12" cy="12.4" r="1.15" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

export function Wordmark({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("group inline-flex items-center gap-2.5 text-ink transition hover:text-lime", className)}
      aria-label="MeshStream home"
    >
      <span className="text-lime">
        <LogoMark className="h-[22px] w-[22px]" />
      </span>
      <span className="font-display text-[17px] font-semibold tracking-[-0.04em]">
        meshstream
      </span>
    </Link>
  );
}
