import { parseTarget } from "../_lib/mediaProxy";
import { resolveStreamUrl } from "../../src/lib/video/resolve";

/**
 * Resolve an HTML embed/player URL to a direct video or HLS stream URL.
 * Returns { streamUrl } on success and 404 when nothing playable is found.
 */
export async function onRequestGet({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const raw = params.get("url") || params.get("embedUrl");
  const target = parseTarget(raw);

  if (!target) {
    return new Response(JSON.stringify({ error: "Missing or invalid url" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const streamUrl = await resolveStreamUrl(target.toString());
  if (!streamUrl) {
    return new Response(
      JSON.stringify({ error: "No playable stream found", url: target.toString() }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response(JSON.stringify({ streamUrl }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
