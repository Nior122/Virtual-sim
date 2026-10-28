import type { Env, TelegramUpdate } from "../../src/lib/bot/types";
import { handleUpdate } from "../../src/lib/bot/handler";
import { configureManagerTelegram } from "../../src/lib/manager";

/**
 * Telegram webhook endpoint.
 * Register it with:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<pages-domain>/api/telegram-bot&secret_token=<SECRET>"
 */
export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  // Bot chat replies fall back to the same manager link as the site chat.
  configureManagerTelegram(env);

  // Telegram echoes the secret configured in setWebhook on every call.
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Always acknowledge quickly so Telegram does not retry; surface failures
  // to the chat instead of throwing out of the webhook.
  try {
    const origin = new URL(request.url).origin;
    await handleUpdate(env, update, origin);
  } catch (err) {
    console.error("telegram-bot handler error:", err);
    const chatId = update.message?.chat?.id;
    if (chatId && env.TELEGRAM_BOT_TOKEN) {
      try {
        await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Something went wrong: ${(err as Error).message}`,
            }),
          }
        );
      } catch {
        // best-effort error delivery
      }
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Simple health check if the endpoint is opened in a browser.
export async function onRequestGet(): Promise<Response> {
  return new Response(JSON.stringify({ status: "telegram webhook alive" }), {
    headers: { "Content-Type": "application/json" },
  });
}
