/**
 * The chat's "manager" link points here instead of at Telegram directly.
 *
 * Guests must never see the bot's handle — not in the message text, not in the
 * status bar on hover, not in a mobile long-press or "copy link". An anchor to
 * https://t.me/<handle> leaks it in all three. This endpoint answers with a 302
 * to the real Telegram URL, so the visible link is just /manager.
 *
 * The target comes from `MANAGER_TELEGRAM` (or the default in
 * src/lib/manager.ts), so changing the handle never needs this file touched.
 */
import { configureManagerTelegram, managerLinkUrl } from "../src/lib/manager";

export async function onRequest({
  request,
  env,
}: {
  request: Request;
  env?: { MANAGER_TELEGRAM?: string } | any;
}): Promise<Response> {
  configureManagerTelegram(env);

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  // 302 (not 301) on purpose: the handle can change via the environment, and a
  // cached permanent redirect would keep sending guests to the old bot.
  return new Response(null, {
    status: 302,
    headers: {
      Location: managerLinkUrl(),
      "Cache-Control": "no-store",
    },
  });
}
