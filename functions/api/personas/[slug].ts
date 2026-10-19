import type { Env } from "../../../src/lib/bot/types";
import { getPublicPersonaBySlug } from "../../../src/lib/db/neon";

/**
 * Single public persona with its videos, read directly from Neon.
 * Replaces the Express GET /api/personas/:slug route. The systemPrompt
 * column is never selected, so it cannot leak to the browser.
 */
export async function onRequestGet({
  env,
  params,
}: {
  env: Env;
  params: { slug?: string };
}): Promise<Response> {
  const slug = decodeURIComponent(params.slug || "");
  if (!slug) {
    return new Response(JSON.stringify({ error: "Missing slug" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const persona = await getPublicPersonaBySlug(env, slug);
    if (!persona) {
      return new Response(JSON.stringify({ error: "Persona not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(persona), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
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
