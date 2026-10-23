import type { Env } from "../../../src/lib/bot/types";
import { getPublicPersonaBySlug } from "../../../src/lib/db/neon";
import { toPlaybackUrl } from "../../../src/lib/video/playback";
import { readPrivateMode } from "../../../src/lib/access/mode";

/**
 * Single public persona with its videos, read directly from Neon.
 * Replaces the Express GET /api/personas/:slug route. The systemPrompt
 * column is never selected, so it cannot leak to the browser.
 */
export async function onRequestGet({
  env,
  params,
  request,
}: {
  env: Env;
  params: { slug?: string };
  request: Request;
}): Promise<Response> {
  const slug = decodeURIComponent(params.slug || "");
  if (!slug) {
    return new Response(JSON.stringify({ error: "Missing slug" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Private mode does not restrict which profile can be read — every profile
  // is reachable at its own URL — but its content must not sit in a shared
  // cache while the site is in its "no catalogue" state.
  let privateMode = false;
  try {
    const mode = await readPrivateMode(env);
    privateMode = mode.enabled;
  } catch {
    privateMode = false;
  }

  try {
    const persona = await getPublicPersonaBySlug(env, slug);
    if (!persona) {
      return new Response(JSON.stringify({ error: "Persona not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Every remote video is played through our own Pages Function so
    // hotlink-protected CDNs, missing CORS headers and HTML embeds all work
    // on the call screen. Telegram media (/api/media/...) is left untouched.
    if (Array.isArray((persona as any).videos)) {
      (persona as any).videos = (persona as any).videos.map(
        (video: { url?: string; streamUrl?: string }) => ({
          ...video,
          streamUrl: toPlaybackUrl(video.url || video.streamUrl),
        })
      );
    }

    return new Response(JSON.stringify(persona), {
      headers: {
        "Content-Type": "application/json",
        // Private mode is per-visitor, so the response must not be cached
        // publicly and served to someone without a share link.
        "Cache-Control": privateMode ? "no-store, max-age=0" : "public, max-age=60",
      },
    });
  } catch (err) {
    console.error(`GET /api/personas/${slug} failed:`, err);
    return new Response(
      JSON.stringify({ error: "Failed to load persona" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
