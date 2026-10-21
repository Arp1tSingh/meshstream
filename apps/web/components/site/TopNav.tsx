"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Radio } from "lucide-react";
import { Avatar, Button, buttonClass } from "@/components/ui";
import { useGuest } from "@/components/providers/GuestProvider";
import { Wordmark } from "./Logo";
import { cn } from "@/lib/cn";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/#live", label: "Live now" },
  { href: "/library", label: "Library" },
];

export function TopNav() {
  const pathname = usePathname();
  const { guest, loading, openProfile } = useGuest();

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[60px] w-full max-w-[1320px] items-center justify-between gap-6 px-5 lg:px-8">
        <div className="flex items-center gap-8">
          <Wordmark />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((link) => {
              const active =
                link.href === pathname ||
                (link.href !== "/#live" && pathname.startsWith(`${link.href}/`));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12.5px] transition",
                    active
                      ? "bg-white/[0.055] text-ink"
                      : "text-muted hover:bg-white/[0.04] hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/how-it-works"
            className="hidden items-center gap-2 rounded-full border border-line bg-white/[0.02] px-3 py-1.5 text-[11px] text-muted transition hover:border-line-strong hover:text-ink sm:flex"
          >
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-lime" />
            P2P live
          </Link>

          <button
            type="button"
            onClick={openProfile}
            className="group flex items-center gap-2 rounded-full border border-line bg-white/[0.02] py-1 pl-1 pr-2.5 transition hover:border-line-strong"
            aria-label="Edit guest profile"
          >
            {guest ? (
              <Avatar name={guest.displayName} color={guest.color} size={26} />
            ) : (
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line bg-raised text-[10px] text-faint">
                ?
              </span>
            )}
            <span className="hidden max-w-28 truncate text-[12px] text-muted group-hover:text-ink sm:block">
              {loading ? "Guest…" : (guest?.displayName ?? "Guest")}
            </span>
            <ChevronDown className="hidden h-3 w-3 text-faint sm:block" />
          </button>

          <Link href="/studio" className={buttonClass("primary", "sm", "hidden sm:inline-flex")}>
            <Radio className="h-3.5 w-3.5" />
            Go live
          </Link>
          <Link href="/studio" className={buttonClass("primary", "icon", "sm:hidden")} aria-label="Go live">
            <Radio className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
