import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { env } from "./env";
import { registerHlsRoutes } from "./hls";
import { registerRoutes } from "./routes";

mkdirSync(join(env.dataDir, "recordings"), { recursive: true });
mkdirSync(join(env.dataDir, "hls"), { recursive: true });

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: true,
});

await app.register(cookie, { secret: env.cookieSecret });

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    try {
      const url = new URL(origin);
      const allowed =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        origin === env.webOrigin;
      callback(null, allowed);
    } catch {
      callback(null, false);
    }
  },
  credentials: true,
  allowedHeaders: ["content-type", "x-host-key", "x-internal-secret"],
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
});

app.addContentTypeParser(
  "application/sdp",
  { parseAs: "string" },
  (_request, body, done) => done(null, body),
);

await registerRoutes(app);
await registerHlsRoutes(app);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (reply.sent) return;
  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
  const message = (error as { message?: string }).message ?? "internal server error";
  reply.code(statusCode).send({
    error: statusCode < 500 ? message : "internal server error",
  });
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: env.port, host: "0.0.0.0" });
  app.log.info(
    `MeshStream API on http://localhost:${env.port} · media ${env.mediaHlsOrigin}`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
