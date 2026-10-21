import type { Env } from "./types";

/**
 * Public base URL of the site, normalised.
 *
 * `PUBLIC_BASE_URL` is typed into the Cloudflare dashboard by hand, so it very
 * often arrives as `dreambabe.pages.dev` (no scheme) or with a trailing slash.
 * Without a scheme the bot produced links like `dreambabe.pages.dev/dreamgirl/x`
 * — Telegram shows those as plain text, so tapping them did nothing — and the
 * own-site check failed, so those links were scraped as a JS app and reported
 * "no JPEG images found".
 */
export function publicBaseUrl(env: Env, requestOrigin: string): string {
  const raw = (env.PUBLIC_BASE_URL || requestOrigin || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** Absolute profile link for a slug. */
export function profileLink(env: Env, requestOrigin: string, slug: string): string {
  return `${publicBaseUrl(env, requestOrigin)}/dreamgirl/${slug}`;
}
