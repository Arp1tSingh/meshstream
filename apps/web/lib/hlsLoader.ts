"use client";

import Hls, {
  type FragmentLoaderContext,
  type HlsConfig,
  type Loader,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderStats,
} from "hls.js";
import type { SwarmClient } from "@meshstream/swarm";

function isMediaSegment(url: string) {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    return /\.(mp4|m4s|ts|aac)$/i.test(pathname);
  } catch {
    return false;
  }
}

/**
 * hls.js fragment loader that asks the swarm first. Every peer failure falls
 * through to hls.js's stock loader, which fetches from the signed edge URL.
 */
export function createMeshFragmentLoader(swarm: SwarmClient | null) {
  return class MeshFragmentLoader implements Loader<FragmentLoaderContext> {
    context: FragmentLoaderContext | null = null;
    stats: LoaderStats;
    private readonly config: HlsConfig;
    private fallback: Loader<FragmentLoaderContext> | null = null;
    private controller: AbortController | null = null;

    constructor(config: HlsConfig) {
      this.config = config;
      const Base = Hls.DefaultConfig.loader;
      const probe = new Base(config);
      this.stats = probe.stats;
      probe.destroy();
    }

    load(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
    ) {
      this.context = context;
      this.stats.loaded = 0;
      this.stats.total = 0;
      this.stats.retry = 0;
      this.stats.aborted = false;
      this.stats.chunkCount = 0;

      if (!swarm || !isMediaSegment(context.url)) {
        this.loadFallback(context, config, callbacks);
        return;
      }

      this.controller?.abort();
      this.controller = new AbortController();
      const start = performance.now();
      this.stats.loading.start = start;

      swarm
        .fetchPart(context.url, this.controller.signal)
        .then((data) => {
          const end = performance.now();
          this.stats.loaded = data.byteLength;
          this.stats.total = data.byteLength;
          this.stats.chunkCount = 1;
          this.stats.loading.first = end;
          this.stats.loading.end = end;
          this.stats.bwEstimate =
            end > start ? (data.byteLength * 8) / (end - start) : 0;
          callbacks.onSuccess(
            { url: context.url, data },
            this.stats,
            context,
            null,
          );
        })
        .catch(() => {
          if (this.controller?.signal.aborted) {
            callbacks.onAbort?.(this.stats, context, null);
            return;
          }
          this.loadFallback(context, config, callbacks);
        });
    }

    private loadFallback(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
    ) {
      this.fallback?.destroy();
      const Base = Hls.DefaultConfig.loader;
      this.fallback = new Base(this.config) as Loader<FragmentLoaderContext>;
      this.fallback.load(context, config, callbacks);
    }

    abort() {
      this.controller?.abort();
      this.controller = null;
      this.fallback?.abort();
    }

    destroy() {
      this.controller?.abort();
      this.controller = null;
      this.fallback?.destroy();
      this.fallback = null;
    }

    getCacheAge() {
      return this.fallback?.getCacheAge?.() ?? null;
    }

    getResponseHeader(name: string) {
      return this.fallback?.getResponseHeader?.(name) ?? null;
    }
  };
}
