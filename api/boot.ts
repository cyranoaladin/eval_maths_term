import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { createOAuthCallbackHandler, createOAuthInitHandler } from "./kimi/auth";
import { csrfMiddleware } from "./lib/csrf";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// CORS — autorise uniquement les origines configurées
app.use("/api/*", cors({
  origin: env.allowedOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-student-session-token"],
}));

// Route OAuth — démarrage du flow (génère le state CSRF)
app.get("/api/oauth/login", createOAuthInitHandler());
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

// Health check
app.get("/api/health", async (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    serverTime: new Date().toISOString(),
  });
});

// tRPC — avec vérification CSRF sur les mutations
app.use("/api/trpc/*", async (c) => {
  return csrfMiddleware(c.req.raw, async () => {
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        logger.error(`[tRPC] Erreur sur ${path}`, {
          code: error.code,
          message: error.message,
        });
      },
    });
  });
});
app.all("/api/*", (c) => c.json({ error: "Ressource introuvable" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
