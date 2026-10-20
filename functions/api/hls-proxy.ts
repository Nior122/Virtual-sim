import { proxyRequest } from "../_lib/mediaProxy";

/**
 * Playback proxy for HLS streams and HTML embed players.
 * - /api/hls-proxy?url=<m3u8 url> serves the playlist with rewritten URIs
 * - /api/hls-proxy?embedUrl=<player page> resolves the hidden stream first
 *
 * This is the Pages Functions replacement for the Express-only route that the
 * call screen used to call (it 404'd on Pages, which is why videos did not
 * play).
 */
export function onRequest({ request }: { request: Request }): Promise<Response> {
  return proxyRequest(request);
}
