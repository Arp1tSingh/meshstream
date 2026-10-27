"use client";

/**
 * Phase-0 diagnostics helper. Everything is opt-in:
 *   - `?debug=stats` enables it and the choice sticks in localStorage
 *   - `?debug=off` turns it back off
 * Normal viewers/publishers never log, and nothing here adds network traffic.
 */

const STORAGE_KEY = "meshstream:stats-debug";

export function isStatsDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flag = new URLSearchParams(window.location.search).get("debug");
    if (flag === "stats" || flag === "1") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else if (flag === "off" || flag === "0" || flag === "false") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Prints the video m= section of an SDP blob. One-shot per connection, unsampled. */
export function logSdpVideoSection(label: string, sdp: string | null | undefined) {
  if (!sdp || !isStatsDebugEnabled()) return;
  const section: string[] = [];
  let inside = false;
  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith("m=")) {
      if (inside) break;
      inside = line.startsWith("m=video");
    }
    if (inside) section.push(line);
  }
  console.info(
    `[sdp:${label}] ${section.length ? section.join("\n") : "no video m-line found"}`,
  );
}

/** One JSON line per sample so 2 s cadence logs stay grep-friendly and parseable. */
export function debugLogSample(label: string, sample: Record<string, unknown>) {
  if (!isStatsDebugEnabled()) return;
  console.log(`[${label}]`, JSON.stringify(sample));
}
