import { proxyRequest } from "../_lib/mediaProxy";

/**
 * Proxy direct video files (mp4/webm/mov/m4v) and HLS playlists.
 * - forwards the browser's Range header so seeking works
 * - sends a Referer so CDNs with hotlink protection still serve the file
 * - rewrites m3u8 playlists so nested variants/segments come back through here
 *
 * Usage: /api/video-proxy?url=<encoded absolute url>[&referer=<encoded>]
 */
export function onRequest({ request }: { request: Request }): Promise<Response> {
  return proxyRequest(request);
}
