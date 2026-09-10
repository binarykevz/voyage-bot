import { webhookCallback } from "grammy/webhook";
import { createBot } from "./bot";
import { Env } from "./env";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Optional: Health check endpoint for monitoring
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Initialize bot with environment secrets
    const bot = createBot(env);

    // Create webhook handler optimized for Cloudflare Workers
    const handleUpdate = webhookCallback(bot, "cloudflare-modern");

    return handleUpdate(request);
  },
};
