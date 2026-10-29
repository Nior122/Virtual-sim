/**
 * How long the phone rings before she picks up — or doesn't.
 *
 * Every call used to connect after the same 1.5–3 s, so the ring felt like a
 * loading spinner: the outcome was known before the second ring and no call
 * ever rang out. Real calls are uneven. This module draws one plan per call:
 *
 *   instant   ~0.2–0.9 s   she was already holding the phone
 *   quick     ~2–5 s
 *   normal    ~5 s, ~10 s or ~15 s   (three buckets, each its own weight)
 *   slow      ~20 s or ~25 s
 *   very slow ~30 s
 *   missed     never — the phone rings 40–50 s and the call ends
 *
 * The weights add up to 100, so the mix stays believable: most calls are
 * answered in a few rings, a few take half a minute, and one in twelve rings
 * out. A missed call costs the client nothing (no call is counted, see
 * `countThisCall`), which is why it can happen at all.
 *
 * Pure and Workers-safe: no `node:` imports, no I/O, and the RNG is injectable
 * so the distribution can be tested instead of hoped for.
 */
export type PickupOutcome = "instant" | "quick" | "normal" | "slow" | "very-slow" | "missed";

export interface PickupPlan {
  outcome: PickupOutcome;
  /** True when she never answers: the phone rings out and the call ends. */
  missed: boolean;
  /** How long the phone rings before her video starts. null when missed. */
  answerAfterMs: number | null;
  /** When the call gives up: a missed call, or an answer whose video never loads. */
  ringMs: number;
  /** Human-readable summary for the console ("~20 s", "missed (43 s)"). */
  label: string;
}

interface Bucket {
  outcome: PickupOutcome;
  /** Share of calls, out of 100. */
  weight: number;
  minMs: number;
  maxMs: number;
}

/**
 * The whole behaviour of the ringing in one table.
 *
 * `maxMs` of a bucket is inclusive. Ranges sit either side of the round numbers
 * a person would notice (5, 10, 15, 20, 30 s) so two calls never produce the
 * same stopwatch value twice in a row.
 */
export const PICKUP_BUCKETS: Bucket[] = [
  // She had the phone in her hand — no real ringing at all.
  { outcome: "instant", weight: 6, minMs: 200, maxMs: 900 },
  { outcome: "quick", weight: 12, minMs: 2_000, maxMs: 5_000 },
  // ≈5 s
  { outcome: "normal", weight: 15, minMs: 4_500, maxMs: 7_000 },
  // ≈10 s
  { outcome: "normal", weight: 15, minMs: 8_500, maxMs: 12_000 },
  // ≈15 s
  { outcome: "normal", weight: 13, minMs: 13_500, maxMs: 17_000 },
  // ≈20 s
  { outcome: "slow", weight: 13, minMs: 18_500, maxMs: 22_000 },
  // ≈25 s
  { outcome: "slow", weight: 8, minMs: 24_000, maxMs: 27_500 },
  // ≈30 s
  { outcome: "very-slow", weight: 10, minMs: 28_500, maxMs: 32_000 },
  // Never answers: rings out for 40–50 s, then the call ends.
  { outcome: "missed", weight: 8, minMs: 40_000, maxMs: 50_000 },
];

const TOTAL_WEIGHT = PICKUP_BUCKETS.reduce((sum, bucket) => sum + bucket.weight, 0);

/** Longest a phone may ring before the call is over (the missed bucket's max). */
export const MAX_RING_MS = Math.max(...PICKUP_BUCKETS.map((bucket) => bucket.maxMs));

/**
 * Extra time after she answers before the call is declared dead. Covers the
 * seconds a stream needs to buffer, so a slow clip is not mistaken for a line
 * that never connected (the video itself reports failures after 8 s).
 */
export const PICKUP_GRACE_MS = 12_000;

/**
 * The user answered *her* incoming call — she is already on the line, so the
 * video starts straight away and the ringback never plays.
 */
export const INCOMING_ANSWER_MS = 1_000;

function pick<T>(items: T[], random: () => number): T {
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)));
  return items[index];
}

function randomBetween(minMs: number, maxMs: number, random: () => number): number {
  const value = minMs + Math.floor(random() * (maxMs - minMs + 1));
  return Math.min(maxMs, Math.max(minMs, value));
}

function formatDelay(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(/\.0$/, "")} s`;
}

/**
 * Draws the ringing plan for one call.
 *
 * Pass a fixed `random` (a seeded LCG, or `() => 0`) to make the outcome
 * deterministic in tests.
 */
export function planPickup(random: () => number = Math.random): PickupPlan {
  const roll = Math.min(0.999999, Math.max(0, random())) * TOTAL_WEIGHT;
  let cumulative = 0;
  let bucket = PICKUP_BUCKETS[PICKUP_BUCKETS.length - 1];
  for (const candidate of PICKUP_BUCKETS) {
    cumulative += candidate.weight;
    if (roll < cumulative) {
      bucket = candidate;
      break;
    }
  }

  const ringMs = randomBetween(bucket.minMs, bucket.maxMs, random);

  if (bucket.outcome === "missed") {
    return {
      outcome: bucket.outcome,
      missed: true,
      answerAfterMs: null,
      ringMs,
      label: `missed (rings ${formatDelay(ringMs)})`,
    };
  }

  return {
    outcome: bucket.outcome,
    missed: false,
    answerAfterMs: ringMs,
    // Her answer gets a grace period on top: a video that needs a few seconds
    // to buffer must not be reported as a busy line the moment she says hello.
    ringMs: ringMs + PICKUP_GRACE_MS,
    label: `${bucket.outcome} (~${formatDelay(ringMs)})`,
  };
}

/** The plan for a call the user accepted from her (no ringback, no wait). */
export function incomingAnswerPlan(): PickupPlan {
  return {
    outcome: "instant",
    missed: false,
    answerAfterMs: INCOMING_ANSWER_MS,
    ringMs: INCOMING_ANSWER_MS + PICKUP_GRACE_MS,
    label: `answered incoming (~${INCOMING_ANSWER_MS / 1000} s)`,
  };
}

/**
 * Delay before the first ringback tone.
 *
 * Without it an "instant" pickup would beep the ring tone over her greeting.
 * Keeping the first ~0.9 s silent makes a fast answer feel like a real one:
 * the line is quiet, then she is there.
 */
export const RINGBACK_START_MS = 900;


// ---------------------------------------------------------------------------
// What she says afterwards
// ---------------------------------------------------------------------------
/**
 * Sent in the chat a few seconds after a call rang out unanswered. Rejection
 * messages ("you asked me to call and didn't answer") would be wrong here —
 * the *user* called, so she apologises for missing it and invites another try.
 */
export const MISSED_CALL_FOLLOW_UPS = [
  "Ugh I'm so sorry babe, my phone was in the other room 😩 Call me back?",
  "Nooo did I miss you? 🙈 I was in the shower, call me again in a bit 💕",
  "I just saw the missed call 😭 I had my hands full… try me again?",
  "Sorry baby, I couldn't reach my phone in time 🥺 Are you free to call again?",
  "I heard it ringing and couldn't get to it fast enough 😩 Call me back?",
  "My phone was on silent because I was out 🙈 Call me again and I'll pick up, promise 💋",
  "Aww you called and I missed it! 😔 Give me another try babe?",
  "I'm the worst, I know 😅 I was busy and my phone was in my bag. Call me again?",
];

export function getMissedCallFollowUp(random: () => number = Math.random): string {
  return pick(MISSED_CALL_FOLLOW_UPS, random);
}
