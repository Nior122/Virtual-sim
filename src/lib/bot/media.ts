import type { Env } from "./types";
import { getFilePath, buildFileDownloadUrl } from "./telegram";
import { lookupMedia } from "./store";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

function mimeFromPath(filePath: string, fallback?: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXT[ext] || fallback || "application/octet-stream";
}

/**
 * Streams a Telegram file through the Pages Function so the bot token never
 * appears in public profile data. Only file_ids registered via the bot are
 * served. Range requests are forwarded so the call-screen <video> can seek.
 */
export async function serveMedia(
  env: Env,
  fileId: string,
  request: Request
): Promise<Response> {
  const allowed = await lookupMedia(env, fileId);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Unknown media" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const filePath = await getFilePath(env, fileId);
  if (!filePath) {
    return new Response(JSON.stringify({ error: "Telegram file unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const upstreamHeaders: Record<string, string> = {};
  const range = request.headers.get("Range");
  if (range) upstreamHeaders["Range"] = range;

  const upstream = await fetch(buildFileDownloadUrl(env, filePath), {
    headers: upstreamHeaders,
  });

  const headers = new Headers();
  headers.set(
    "Content-Type",
    mimeFromPath(filePath, allowed.mime)
  );
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=86400");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

/** Public, token-free URL persisted into the persona records. */
export function buildPublicMediaUrl(
  env: Env,
  requestOrigin: string,
  fileId: string
): string {
  const origin = (env.PUBLIC_BASE_URL || requestOrigin).replace(/\/+$/, "");
  return `${origin}/api/media/${encodeURIComponent(fileId)}`;
}
