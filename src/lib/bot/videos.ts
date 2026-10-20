// ---------------------------------------------------------------------------
// Shared video preparation used by /confirm, /save and bulk generation.
// Turns stored/ scraped URLs into something the call screen can play.
// ---------------------------------------------------------------------------
import {
  isDirectVideoUrl,
  isEmbedUrl,
  isPlayableVideoUrl,
} from "../video/playback";
import { resolveStreamUrl } from "../video/resolve";

export interface PlaybackBudget {
  /** How many embed lookups have been spent so far */
  attempts: number;
  /** Maximum embed lookups allowed in this invocation */
  max: number;
}

export function newPlaybackBudget(max = 8): PlaybackBudget {
  return { attempts: 0, max };
}

/**
 * Returns a playable URL for one video entry, or null when it has no usable
 * stream. Direct files and HLS are returned untouched; HTML embed players are
 * resolved (bounded by the budget) because they cannot be played directly.
 */
export async function toPlayableVideoUrl(
  url: string,
  budget: PlaybackBudget,
  timeoutMs = 6000
): Promise<string | null> {
  if (!url) return null;
  if (isPlayableVideoUrl(url)) return url;
  if (isEmbedUrl(url) && budget.attempts < budget.max) {
    budget.attempts += 1;
    const resolved = await resolveStreamUrl(url, timeoutMs);
    if (resolved && (isPlayableVideoUrl(resolved) || isDirectVideoUrl(resolved))) {
      return resolved;
    }
  }
  return null;
}

export interface PreparedVideos {
  /** Playable URLs, in input order, deduplicated */
  urls: string[];
  /** Entries dropped because no playable stream could be found */
  unresolved: number;
  /** Embed lookups spent (subrequests) */
  attempts: number;
}

/** Prepare a plain list of video URLs (bulk generation). */
export async function prepareVideoUrls(
  urls: string[],
  budget: PlaybackBudget = newPlaybackBudget()
): Promise<PreparedVideos> {
  const playable: string[] = [];
  let unresolved = 0;
  for (const url of urls) {
    if (!url || playable.includes(url)) continue;
    const resolved = await toPlayableVideoUrl(url, budget);
    if (resolved) {
      if (!playable.includes(resolved)) playable.push(resolved);
    } else {
      unresolved += 1;
    }
  }
  return { urls: playable, unresolved, attempts: budget.attempts };
}
