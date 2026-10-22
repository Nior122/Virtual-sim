import type { Env } from "../../src/lib/bot/types";
import { listPublicPersonas } from "../../src/lib/db/neon";
import { readPrivateMode } from "../../src/lib/access/mode";

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
  // The catalog is the one response that lists every profile. In private mode
  // it must not exist, even if a request reaches this Function directly.
  try {
    const mode = await readPrivateMode(env);
    if (mode.enabled) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
  } catch {
    // Fall through to the normal list.
  }

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
