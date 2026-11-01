// ---------------------------------------------------------------------------
// Browser-side advert settings.
//
// One request per page load, shared by every consumer (the injector on the
// page and the chat's send button), so switching tabs inside the SPA never
// costs another round trip. A failed request falls back to the built-in
// defaults instead of throwing: adverts must never be able to break the chat.
// ---------------------------------------------------------------------------
import { defaultAdSettings, normaliseAdSettings, type AdSettings } from "./config";

const CACHE_MS = 60_000;

let cached: { at: number; settings: AdSettings } | null = null;
let inflight: Promise<AdSettings> | null = null;

/** Load the owner's advert configuration. Never rejects. */
export async function getAdSettings(force = false): Promise<AdSettings> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.settings;
  }
  if (inflight) return inflight;

  inflight = fetch("/api/ads", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const type = res.headers.get("content-type") || "";
      if (!type.includes("application/json")) return null;
      return (await res.json()) as unknown;
    })
    .then((data) => {
      const settings = normaliseAdSettings(data);
      cached = { at: Date.now(), settings };
      return settings;
    })
    .catch(() => cached?.settings ?? defaultAdSettings())
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Drop the cache — used after the owner saves a change. */
export function forgetAdSettings(): void {
  cached = null;
}

/**
 * Open a URL in a new tab from inside a click handler.
 *
 * `window.open` is what networks count, but a browser that blocks it (an
 * in-app WebView, a blocker, a strict Safari setting) returns null — then a
 * real anchor click is dispatched instead, which the same browser honours.
 */
export function openExternalTab(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened && typeof opened.closed !== "undefined" && !opened.closed) {
      return true;
    }
  } catch {
    /* fall through to the anchor */
  }
  try {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (err) {
    console.error("Could not open the advert link:", err);
    return false;
  }
}
