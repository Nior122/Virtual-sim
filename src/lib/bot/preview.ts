/**
 * Preview review: the buttons under `/preview` that let the owner delete a
 * photo or a video before the profile is created.
 *
 * Before this existed the only way to drop one bad image was to throw the whole
 * draft away, because `/preview` regenerates the AI text every time and the
 * numbering the owner was reading would move. The model here is *exclusions*:
 * a removed URL is remembered on the draft and filtered out of every list the
 * bot renders and every list `/confirm` uses, so nothing is destroyed (undo is
 * exact) and the numbering always matches what the button showed.
 *
 * Pure and Workers-safe: no `node:` imports, no I/O.
 */
import type { Draft } from "./types";
import type { InlineKeyboard } from "./telegram";

export type PreviewMediaKind = "image" | "video";

/** One excluded URL, in the order the owner removed them (so undo is LIFO). */
export interface ExcludedMedia {
  kind: PreviewMediaKind;
  url: string;
}

/** Images are at most 7, so every one gets a button. */
export const PREVIEW_IMAGE_PER_ROW = 4;
/** Videos can be 50: buttons for the first 15, `/remove` for the rest. */
export const PREVIEW_MAX_VIDEO_BUTTONS = 15;
export const PREVIEW_VIDEO_PER_ROW = 5;

// ---------------------------------------------------------------------------
// Exclusions (the draft is the single source of truth)
// ---------------------------------------------------------------------------
function stack(draft: Draft): ExcludedMedia[] {
  if (!Array.isArray(draft.excludedMedia)) draft.excludedMedia = [];
  return draft.excludedMedia;
}

export function isExcluded(
  draft: Draft,
  kind: PreviewMediaKind,
  url: string
): boolean {
  return stack(draft).some((entry) => entry.kind === kind && entry.url === url);
}

/** Remember that this URL must not be used. False when it already was. */
export function excludeUrl(
  draft: Draft,
  kind: PreviewMediaKind,
  url: string
): boolean {
  if (!url || isExcluded(draft, kind, url)) return false;
  stack(draft).push({ kind, url });
  return true;
}

/** Undo the most recent removal, whoever made it (button or command). */
export function undoLastExclusion(draft: Draft): ExcludedMedia | null {
  const entries = stack(draft);
  const last = entries.pop();
  return last ?? null;
}

export function clearExclusions(draft: Draft): void {
  draft.excludedMedia = [];
}

/**
 * The same URL was added again, so it must be visible again: re-adding is
 * itself an un-delete. Returns true when an exclusion was lifted.
 */
export function restoreUrl(
  draft: Draft,
  kind: PreviewMediaKind,
  url: string
): boolean {
  const entries = stack(draft);
  const index = entries.findIndex((entry) => entry.kind === kind && entry.url === url);
  if (index === -1) return false;
  entries.splice(index, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Inline keyboard
// ---------------------------------------------------------------------------
export interface PreviewCounts {
  images: number;
  videos: number;
  canUndo: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/**
 * `✅ Create profile` first, then one delete button per item.
 *
 * The button text carries the same number the preview lists above it, so
 * "🖼 3" and `3. https://…jpg` are always the same photo. Videos beyond the
 * button budget are not silently unreachable: the reply text tells the owner
 * to use `/remove <numbers>`.
 */
export function buildPreviewKeyboard({
  images,
  videos,
  canUndo,
}: PreviewCounts): InlineKeyboard {
  const keyboard: InlineKeyboard = [
    [{ text: "✅ Create profile", callback_data: "pv:ok" }],
  ];

  if (images > 0) {
    const buttons = Array.from({ length: images }, (_, i) => ({
      text: `🖼 ${i + 1}`,
      callback_data: `pv:rm:i:${i + 1}`,
    }));
    keyboard.push(...chunk(buttons, PREVIEW_IMAGE_PER_ROW));
  }

  if (videos > 0) {
    const shown = Math.min(videos, PREVIEW_MAX_VIDEO_BUTTONS);
    const buttons = Array.from({ length: shown }, (_, i) => ({
      text: `🎬 ${i + 1}`,
      callback_data: `pv:rm:v:${i + 1}`,
    }));
    keyboard.push(...chunk(buttons, PREVIEW_VIDEO_PER_ROW));
  }

  const footer: { text: string; callback_data: string }[] = [];
  if (canUndo) footer.push({ text: "↩️ Undo last removal", callback_data: "pv:undo" });
  footer.push({ text: "✖️ Cancel draft", callback_data: "pv:cancel" });
  keyboard.push(footer);
  return keyboard;
}

/** Hint line shown under a preview that has delete buttons. */
export function previewKeyboardHint(counts: PreviewCounts): string {
  if (counts.images + counts.videos === 0) {
    return "Add a photo or a video before creating the profile.";
  }
  const bits = [
    `Tap 🖼 / 🎬 to delete a photo or video before creating`,
    `✅ Create profile uses the list as it is`,
  ];
  if (counts.videos > PREVIEW_MAX_VIDEO_BUTTONS) {
    bits.push(
      `videos past ${PREVIEW_MAX_VIDEO_BUTTONS} have no button — use /remove <numbers>`
    );
  }
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// Callback data
// ---------------------------------------------------------------------------
export type PreviewAction =
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "undo" }
  | { kind: "remove"; media: PreviewMediaKind; index: number };

/** `pv:ok` · `pv:cancel` · `pv:undo` · `pv:rm:i:3` · `pv:rm:v:12` */
export function parsePreviewCallback(data: string): PreviewAction | null {
  if (!data.startsWith("pv:")) return null;
  const parts = data.split(":");
  if (parts.length === 2) {
    if (parts[1] === "ok") return { kind: "confirm" };
    if (parts[1] === "cancel") return { kind: "cancel" };
    if (parts[1] === "undo") return { kind: "undo" };
    return null;
  }
  if (parts.length === 4 && parts[1] === "rm") {
    const media = parts[2] === "i" ? "image" : parts[2] === "v" ? "video" : null;
    const index = parseInt(parts[3], 10);
    if (!media || !Number.isFinite(index) || index < 1) return null;
    return { kind: "remove", media, index };
  }
  return null;
}
