// ---------------------------------------------------------------------------
// Which clip plays when a call connects.
//
// Videos come out of the database in upload order (`ORDER BY "createdAt" ASC`).
// Picking `videos[0]` — or picking uniformly at random from that list every
// time — means a profile with two clips shows the same one over and over, and
// the visitor reads it as "her video is always the same".
//
// So rotation is a shuffled bag per profile:
//
//   • the first call of a cycle takes a clip from a freshly shuffled deck, so
//     it is genuinely random, not the newest upload;
//   • that clip is removed from the deck, so every clip gets a turn before any
//     repeats;
//   • a new deck never starts with the clip that just played, so two calls in
//     a row are never the same when there is more than one video;
//   • the deck lives in localStorage, so it survives a reload and a return
//     visit, and falls back to memory when storage is blocked.
//
// Nothing here touches the call itself: the result is one video object, and the
// caller keeps its own timeouts and state machine.
// ---------------------------------------------------------------------------

export interface RotatableVideo {
  id?: string | null;
  url?: string | null;
}

export const ROTATION_PREFIX = "dg:video-rotation:";

interface RotationState {
  /** Keys still to be played in this cycle, in the order they will play. */
  bag: string[];
  /** The clip that played last, so a new cycle can avoid opening with it. */
  last: string | null;
}

/** A stable key for a video row: its id, or its URL when the id is missing. */
export function videoKey(video: RotatableVideo): string {
  const id = typeof video.id === "string" ? video.id.trim() : "";
  if (id) return `id:${id}`;
  const url = typeof video.url === "string" ? video.url.trim() : "";
  return url ? `url:${url}` : "";
}

/** Fisher–Yates on a copy — the input order is never mutated. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function rotationStorageKey(slug: string): string {
  return `${ROTATION_PREFIX}${slug.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Storage: localStorage when it works, memory otherwise
// ---------------------------------------------------------------------------
const memory = new Map<string, RotationState>();

function readState(slug: string): RotationState {
  const key = rotationStorageKey(slug);
  if (memory.has(key)) return memory.get(key) as RotationState;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RotationState>;
      const bag = Array.isArray(parsed.bag)
        ? parsed.bag.filter((entry): entry is string => typeof entry === "string")
        : [];
      const last = typeof parsed.last === "string" ? parsed.last : null;
      return { bag, last };
    }
  } catch {
    /* storage blocked or corrupt: fall through to a fresh cycle */
  }
  return { bag: [], last: null };
}

function writeState(slug: string, state: RotationState): void {
  const key = rotationStorageKey(slug);
  memory.set(key, state);
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* the memory copy still rotates for this page */
  }
}

/** Forget a profile's cycle — used when a video is deleted or replaced. */
export function resetRotation(slug: string): void {
  const key = rotationStorageKey(slug);
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clean up */
  }
}

// ---------------------------------------------------------------------------
// The pick
// ---------------------------------------------------------------------------
function playable<T extends RotatableVideo>(videos: T[]): T[] {
  return (videos || []).filter(
    (video) => video && typeof video.url === "string" && video.url.trim().length > 0
  );
}

/**
 * The clip this call should open with.
 *
 * Returns `null` when the profile has no playable video. The returned object is
 * the original array entry, never a copy, so ids and stream URLs survive.
 */
export function pickRotatingVideo<T extends RotatableVideo>(
  videos: T[],
  slug: string,
  random: () => number = Math.random
): T | null {
  const playableVideos = playable(videos);
  if (playableVideos.length === 0) return null;
  if (playableVideos.length === 1) {
    // One clip: still record it, so adding a second one does not replay it.
    writeState(slug, { bag: [], last: videoKey(playableVideos[0]) });
    return playableVideos[0];
  }

  const byKey = new Map<string, T>();
  playableVideos.forEach((video) => {
    const key = videoKey(video);
    if (key && !byKey.has(key)) byKey.set(key, video);
  });
  if (byKey.size === 0) return playableVideos[0];

  const state = readState(slug);

  // Drop clips that were deleted since the deck was written, and any key that
  // is no longer playable, so a stale deck can never strand a call.
  let bag = state.bag.filter((key, index) => byKey.has(key) && state.bag.indexOf(key) === index);

  if (bag.length === 0) {
    bag = shuffle(Array.from(byKey.keys()), random);
    // A new cycle must not open with the clip that just played.
    if (bag.length > 1 && bag[0] === state.last) {
      const swapIndex = 1 + Math.floor(random() * (bag.length - 1));
      const first = bag[0];
      bag[0] = bag[swapIndex];
      bag[swapIndex] = first;
    }
  }

  const key = bag[0];
  const video = byKey.get(key) || playableVideos[0];
  writeState(slug, { bag: bag.slice(1), last: key });
  return video;
}

/**
 * A random order of every clip, for the in-call fallback when a stream fails.
 * The next clip after an error should not follow the upload order either.
 */
export function shuffledOrder<T extends RotatableVideo>(
  videos: T[],
  random: () => number = Math.random
): T[] {
  return shuffle(playable(videos), random);
}
