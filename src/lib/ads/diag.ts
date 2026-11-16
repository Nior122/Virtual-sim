// ---------------------------------------------------------------------------
// Advert diagnostics, shared by every advert component.
//
// "The adverts are not showing" has a handful of causes, and from the outside
// they all look the same: a page with no advert on it. Each component records
// what it decided instead of failing silently, and the admin panel documents
// the console helper that reads this back:
//
//     __dgAds()   →  [{ format, verdict, detail, at }, …]
//
// The log is module scope on purpose: it survives React's StrictMode
// double-mount, so a format can explain itself once rather than twice.
// ---------------------------------------------------------------------------

export type AdFormat = "popunder" | "socialBar" | "native" | "placement";

export type AdVerdict =
  | "injected"
  | "empty-code"
  | "house-fallback"
  | "disabled"
  | "already-fired"
  | "capped"
  | "not-allowed-on-route"
  | "dismissed"
  | "no-link"
  /** The pop-under held back because no advert was visible on the page. */
  | "no-advert-on-page";

export interface AdReport {
  format: AdFormat;
  verdict: AdVerdict;
  detail?: string;
  /** `<script>` elements re-created (and therefore executed). */
  scripts?: number;
  /** True when the snippet was confined to a sandboxed frame. */
  framed?: boolean;
  at: number;
}

const entries: AdReport[] = [];

/** Record one decision. */
export function noteAd(entry: Omit<AdReport, "at">): void {
  entries.push({ ...entry, at: Date.now() });
}

/** Everything recorded so far, oldest first. */
export function adReport(): AdReport[] {
  return entries.slice();
}

/** The verdict recorded for a format, or undefined if it never ran. */
export function adVerdict(format: AdFormat): AdVerdict | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].format === format) return entries[i].verdict;
  }
  return undefined;
}

/**
 * Expose `__dgAds()` on the page.
 *
 * Installed once, from any component that may need it, and available even
 * before the first verdict so the console helper never reads `undefined`.
 */
let installed = false;
export function installAdDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  (window as unknown as { __dgAds?: () => AdReport[] }).__dgAds = adReport;
}
