import type { Env } from "../../src/lib/bot/types";
import { readPrivateMode } from "../../src/lib/access/mode";

/**
 * Public site mode.
 *
 * The SPA calls this once on load. When `private` is true it stops rendering
 * the landing page, the browse grid and every link that points at another
 * profile — the allowed profile keeps working normally.
 *
 * The server-side gate in `functions/_middleware.ts` is the real protection;
 * this endpoint only keeps the UI honest so a visitor never sees a link that
 * looks clickable and then 404s.
 */
export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  const mode = await readPrivateMode(env);
  return new Response(
    JSON.stringify({ private: mode.enabled, updatedAt: mode.updatedAt }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
