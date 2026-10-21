import { existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFiles() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        // ignore malformed env files; explicit process env wins
      }
      break;
    }
  }
}

loadEnvFiles();

const repoRoot = existsSync(resolve(process.cwd(), "../../package.json"))
  ? resolve(process.cwd(), "../..")
  : process.cwd();

export const env = {
  port: Number(process.env.PORT ?? 4000),
  dataDir: resolve(repoRoot, process.env.DATA_DIR ?? "data"),
  cookieSecret: process.env.COOKIE_SECRET ?? "meshstream-dev-cookie-secret-change-me",
  playbackSecret: process.env.PLAYBACK_SECRET ?? "meshstream-dev-playback-secret-change-me",
  internalSecret: process.env.INTERNAL_SECRET ?? "meshstream-dev-internal-secret",
  mediaHlsOrigin: process.env.MEDIA_HLS_ORIGIN ?? "http://127.0.0.1:8888",
  mediaWhipOrigin: process.env.MEDIA_WHIP_ORIGIN ?? "http://127.0.0.1:8889",
  signalStatsUrl: process.env.SIGNAL_STATS_URL ?? "http://127.0.0.1:4001",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  requirePlaybackToken: process.env.REQUIRE_PLAYBACK_TOKEN !== "false",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  originBudgetMbps: Number(process.env.ORIGIN_BUDGET_MBPS ?? 12),
  repoRoot,
};

export const PLAYBACK_TTL_SECONDS = 60 * 60 * 6;
