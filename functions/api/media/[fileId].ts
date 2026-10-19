import type { Env } from "../../../src/lib/bot/types";
import { serveMedia } from "../../../src/lib/bot/media";

/**
 * Public media proxy for files sent to the Telegram bot.
 * Serves only file_ids registered through the bot, keeping the bot token
 * server-side. Supports Range requests for in-page video seeking.
 */
export async function onRequestGet({
  request,
  env,
  params,
}: {
  request: Request;
  env: Env;
  params: { fileId?: string };
}): Promise<Response> {
  const fileId = decodeURIComponent(params.fileId || "");
  if (!fileId) {
    return new Response(JSON.stringify({ error: "Missing file id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return serveMedia(env, fileId, request);
}
