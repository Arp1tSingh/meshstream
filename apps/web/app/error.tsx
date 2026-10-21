"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center px-5 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-warn/30 bg-warn/10">
        <TriangleAlert className="h-6 w-6 text-warn" />
      </span>
      <h1 className="mt-6 text-[28px] tracking-[-0.03em]">The interface tripped.</h1>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
        This screen hit an unexpected client error. Retrying usually reconnects to the stream. If it
        keeps happening, check the API and signal logs.
      </p>
      {error.digest ? (
        <code className="mt-3 rounded border border-line bg-[#0A0C10] px-2 py-1 font-mono text-[9.5px] text-faint">
          digest {error.digest}
        </code>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-lime px-4 text-[12px] font-medium text-[#0A0B0D] transition hover:bg-[#d6ff57]"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </main>
  );
}
