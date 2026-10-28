// ---------------------------------------------------------------------------
// Call regulator — the rules, with no storage and no UI attached.
//
// Two limits, both rolling (not "reset at midnight"):
//
//   1. one call per profile every 2 hours — after a video finishes the call
//      hangs up, and calling that same profile again shows "User Busy" with a
//      Message button until the cooldown is over;
//   2. five calls every 5 hours in total, across every profile — when the last
//      one is used, calling anything shows "Call limit reached" and the client
//      can only chat until a slot frees up.
//
// Both windows roll: a call stops counting exactly N hours after it happened,
// so a client who used their 5 calls at 09:00 can call again from 14:00.
//
// This module is deliberately pure (numbers in, numbers out) so the API, the
// call screen and the tests all agree on the same arithmetic. Times are epoch
// milliseconds; every function takes `now` so it can be tested without waiting.
// ---------------------------------------------------------------------------

export const HOUR_MS = 60 * 60 * 1000;

/** The two limits in one place — change these numbers, nothing else. */
export const CALL_RULES = {
  /** A profile can be called once per this window. */
  cooldownMs: 2 * HOUR_MS,
  /** The global allowance is spent over a rolling window of this length. */
  windowMs: 5 * HOUR_MS,
  /** Calls allowed inside `windowMs`. */
  maxCalls: 5,
} as const;

/** One connected call. */
export interface CallEntry {
  slug: string;
  /** When the call connected (epoch ms). */
  at: number;
}

/** What is stored per visitor in KV. */
export interface CallRecord {
  calls: CallEntry[];
  updatedAt: number;
}

/** Why a call is not allowed right now. */
export type CallBlockReason = "none" | "profile-cooldown" | "window-exhausted";

export interface CallAllowance {
  allowed: boolean;
  reason: CallBlockReason;
  /** Epoch ms when calling becomes possible again. 0 when allowed. */
  retryAt: number;
  /** Calls used inside the rolling window. */
  used: number;
  /** Calls still available inside the rolling window. */
  remaining: number;
  /** Epoch ms when the oldest counted call drops out of the window. */
  windowResetAt: number;
  /** Last connected call to this profile, 0 when it was never called. */
  profileLastAt: number;
}

function clampSlug(slug: string): string {
  return String(slug || "").trim().toLowerCase();
}

/**
 * Drop calls that are older than the window. The 2-hour per-profile cooldown
 * is always inside the 5-hour window, so one pruned list serves both rules.
 */
export function pruneCalls(
  calls: readonly CallEntry[] | undefined,
  now: number,
  windowMs: number = CALL_RULES.windowMs
): CallEntry[] {
  const cutoff = now - windowMs;
  return (calls || [])
    .filter(
      (entry): entry is CallEntry =>
        !!entry &&
        typeof entry.slug === "string" &&
        entry.slug.length > 0 &&
        Number.isFinite(entry.at) &&
        entry.at > cutoff &&
        entry.at <= now
    )
    .sort((a, b) => a.at - b.at);
}

/**
 * Decide whether `slug` can be called at `now`.
 *
 * The global allowance wins over the per-profile cooldown: when every call is
 * spent, no profile can be reached until a slot frees, so the client should be
 * told that rather than "this one is busy".
 */
export function evaluateCalls(
  record: CallRecord | null | undefined,
  slug: string,
  now: number,
  rules: typeof CALL_RULES = CALL_RULES
): CallAllowance {
  const wanted = clampSlug(slug);
  const calls = pruneCalls(record?.calls, now, rules.windowMs);
  const used = calls.length;
  const remaining = Math.max(0, rules.maxCalls - used);
  const windowResetAt = used > 0 ? calls[0].at + rules.windowMs : 0;

  let profileLastAt = 0;
  for (const entry of calls) {
    if (entry.slug === wanted && entry.at > profileLastAt) profileLastAt = entry.at;
  }

  if (used >= rules.maxCalls) {
    return {
      allowed: false,
      reason: "window-exhausted",
      retryAt: windowResetAt,
      used,
      remaining: 0,
      windowResetAt,
      profileLastAt,
    };
  }

  if (profileLastAt > 0 && now - profileLastAt < rules.cooldownMs) {
    return {
      allowed: false,
      reason: "profile-cooldown",
      retryAt: profileLastAt + rules.cooldownMs,
      used,
      remaining,
      windowResetAt,
      profileLastAt,
    };
  }

  return {
    allowed: true,
    reason: "none",
    retryAt: 0,
    used,
    remaining,
    windowResetAt,
    profileLastAt,
  };
}

/**
 * Append a connected call. Callers must have checked `evaluateCalls` first —
 * this does not refuse anything, it only records.
 */
export function recordCall(
  record: CallRecord | null | undefined,
  slug: string,
  now: number,
  rules: typeof CALL_RULES = CALL_RULES
): CallRecord {
  const calls = pruneCalls(record?.calls, now, rules.windowMs);
  calls.push({ slug: clampSlug(slug), at: now });
  // Keep the list sorted and bounded: the window already caps it at maxCalls,
  // but a clock skew or a manual KV edit must not let it grow forever.
  calls.sort((a, b) => a.at - b.at);
  return { calls: calls.slice(-Math.max(rules.maxCalls * 4, 20)), updatedAt: now };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "under a minute", "7 min", "1h 42m", "1d 3h" — for the countdown copy. */
export function formatWait(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "under a minute";
  const minutes = Math.ceil(ms / 60000);
  if (minutes <= 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
}

/** Limits in the shape the API sends to the browser. */
export function publicLimits(rules: typeof CALL_RULES = CALL_RULES) {
  return {
    cooldownMs: rules.cooldownMs,
    windowMs: rules.windowMs,
    maxCalls: rules.maxCalls,
    cooldownHours: rules.cooldownMs / HOUR_MS,
    windowHours: rules.windowMs / HOUR_MS,
  };
}
