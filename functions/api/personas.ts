import type { Env } from "../../src/lib/bot/types";
import { listPublicPersonas } from "../../src/lib/db/neon";

/**
 * Public persona catalog, read directly from Neon.
 * Replaces the Express GET /api/personas route on the Pages deployment.
 * On failure the React client falls back to its built-in DEFAULT_PERSONAS.
 */
export async function onRequestGet({
  env,
}: {
  env: Env;
}): Promise<Response> {
  try {
    const personas = await listPublicPersonas(env);
    return new Response(JSON.stringify(personas), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("GET /api/personas failed:", err);
    return new Response(
      JSON.stringify({ error: "Failed to load personas" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
