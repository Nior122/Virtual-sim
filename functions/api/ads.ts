/**
 * Public advert configuration.
 *
 * The browser needs the owner's snippets to run them, so this route is public
 * by design — client-side ad code is public anyway. Nothing secret is stored
 * next to it: the admin routes live under /api/admin and check their own
 * signed session cookie.
 *
 * Always `no-store`: the owner flips a switch in /admin and expects it to be
 * live on the next page, not in a minute.
 */
import type { Env } from "../../src/lib/bot/types";
import { readAdSettings } from "../../src/lib/ads/store";
import { defaultAdSettings } from "../../src/lib/ads/config";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  try {
    const settings = await readAdSettings(env);
    return new Response(JSON.stringify(settings), { headers: HEADERS });
  } catch {
    // Never break a page because of an advert lookup: the built-in defaults
    // keep the send-button click-through working and run no third-party code.
    return new Response(JSON.stringify(defaultAdSettings()), {
      headers: HEADERS,
    });
  }
}
