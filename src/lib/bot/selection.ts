/**
 * Number selection for the bot's bulk commands.
 *
 * `/removevideo 1-7`, `/remove 1,8,9`, `/remove 1-4,6,28` — owners type these
 * on a phone, so the parser has to survive what a phone keyboard does to them:
 * an autocorrected en dash in "1–7", a stray "#2", spaces instead of commas,
 * "and"-free lists pasted from notes, ranges typed backwards.
 *
 * Pure and dependency-free so it can be unit tested away from Telegram, and
 * Workers-compatible (no node: imports).
 */

export interface Selection {
  ok: true;
  /** 1-based positions, ascending and de-duplicated. */
  indices: number[];
  /** How many repeats were dropped, so the reply can mention it. */
  duplicates: number;
}

export interface SelectionFailure {
  ok: false;
  /** Human sentence naming exactly what could not be read. */
  error: string;
}

export type SelectionResult = Selection | SelectionFailure;

/** Guards against a pathological message (Telegram caps at 4096 chars anyway). */
const MAX_SELECTION = 500;

/** Everything a phone's autocorrect uses for a hyphen. */
function normaliseDashes(value: string): string {
  return value.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE63\uFF0D]/g, "-");
}

/** "1-4,6,28" from [1,2,3,4,6,28] — used in confirmations. */
export function describeSelection(indices: number[]): string {
  if (indices.length === 0) return "none";
  const groups: string[] = [];
  let start = indices[0];
  let previous = indices[0];
  for (const index of indices.slice(1)) {
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    groups.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = index;
    previous = index;
  }
  groups.push(start === previous ? `${start}` : `${start}-${previous}`);
  return groups.join(",");
}

/**
 * Parse `1-7`, `1,8,9`, `1-4,6,28`, `1 - 4 6 28`, `#3`, `all`.
 *
 * `max` is the number of items that currently exist; anything above it is
 * rejected instead of silently ignored, so "1-7" on a five-video profile tells
 * the owner the truth rather than removing three and looking successful.
 */
export function parseSelection(
  input: string,
  max: number,
  noun = "item"
): SelectionResult {
  const raw = normaliseDashes(String(input ?? "")).trim().toLowerCase();
  if (!raw) {
    return {
      ok: false,
      error: `No numbers given. Use a list like 3, 1-7 or 1-4,6,28.`,
    };
  }

  const plural = `${noun}${max === 1 ? "" : "s"}`;

  if (raw === "all" || raw === "*" || raw === "everything") {
    if (max === 0) {
      return { ok: false, error: `There are no ${plural} to remove.` };
    }
    return {
      ok: true,
      indices: Array.from({ length: max }, (_, i) => i + 1),
      duplicates: 0,
    };
  }

  // "1 - 4" is a range; "1, 4" is a list. Collapse spaces around a hyphen so a
  // phone that spaces things out still parses as the owner intended.
  const compact = raw.replace(/\s*-\s*/g, "-");
  const tokens = compact
    .replace(/#/g, "")
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { ok: false, error: `I couldn't find any numbers in that. Use 3, 1-7 or 1-4,6,28.` };
  }
  if (tokens.length > MAX_SELECTION) {
    return { ok: false, error: `That is too many numbers at once (max ${MAX_SELECTION}).` };
  }

  const wanted: number[] = [];
  const outOfRange: number[] = [];
  for (const token of tokens) {
    const single = token.match(/^(\d+)$/);
    const range = token.match(/^(\d+)-(\d+)$/);
    if (!single && !range) {
      return {
        ok: false,
        error: `I couldn't read “${token}”. Use numbers like 3, 1-7 or 1-4,6,28.`,
      };
    }
    if (single) {
      const value = parseInt(single[1], 10);
      if (value < 1) {
        return { ok: false, error: `“${token}” is not a position — numbering starts at 1.` };
      }
      if (value > max) outOfRange.push(value);
      else wanted.push(value);
      continue;
    }
    const a = parseInt(range[1], 10);
    const b = parseInt(range[2], 10);
    if (a < 1 || b < 1) {
      return { ok: false, error: `“${token}” is not a range — numbering starts at 1.` };
    }
    // 7-3 is the same intent as 3-7; accept it rather than arguing.
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    if (from > max) {
      outOfRange.push(from);
      continue;
    }
    for (let value = from; value <= Math.min(to, max); value += 1) wanted.push(value);
    if (to > max) outOfRange.push(to);
  }

  if (outOfRange.length > 0 && wanted.length === 0) {
    const highest = Math.max(...outOfRange);
    return {
      ok: false,
      error:
        max === 0
          ? `There are no ${plural} to remove.`
          : `There is no #${highest} — this draft has ${max} ${plural} (1-${max}). Nothing was removed.`,
    };
  }
  if (outOfRange.length > 0) {
    const highest = Math.max(...outOfRange);
    return {
      ok: false,
      error:
        `There is no #${highest} — this draft has ${max} ${plural} (1-${max}). ` +
        `Nothing was removed; send a list within 1-${max}.`,
    };
  }

  const unique = Array.from(new Set(wanted)).sort((a, b) => a - b);
  return { ok: true, indices: unique, duplicates: wanted.length - unique.length };
}
