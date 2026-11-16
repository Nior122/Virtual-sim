// ---------------------------------------------------------------------------
// Advert slots that the owner pastes into /admin → Adverts.
//
// Design notes (all of them are things that quietly break ad revenue):
//
//   • Ad code is injected as real DOM, not `innerHTML`. A `<script>` created by
//     `innerHTML` never executes, which is the classic "I pasted the code and
//     nothing happened".
//   • Each format fires once per page load. React's StrictMode double-mounts
//     effects in development, and SPA route changes re-run them; without the
//     guard the network sees two impressions per visitor and eventually
//     suspends the account.
//   • A snippet that calls `document.write` is mounted in a sandboxed iframe.
//     `document.write` after load replaces the *whole* document — inside the
//     main page it would erase the site. In a frame it only writes into the
//     frame, and the frame is resized to the ad's real height.
//   • Injection waits for idle time, so adverts never compete with the first
//     paint of the chat.
//   • Placement is decided per route by the same helper the admin panel uses
//     to preview it, so what the owner reads is what happens.
//   • The native banner does not live here. It is an in-page component
//     (`NativeAd`) so it sits *inside* the content the visitor is reading
//     instead of being appended after the footer, and so React re-renders it
//     when the owner changes the copy — an injected node cannot do either.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getAdSettings } from "../lib/ads/client";
import { mountSnippet } from "../lib/ads/inject";
import {
  installAdDiagnostics,
  noteAd,
  type AdFormat,
  type AdVerdict,
} from "../lib/ads/diag";
import {
  placementAllowed,
  placementFor,
  type AdPlacement,
  type AdSettings,
  type AdSlot,
} from "../lib/ads/config";

const POP_KEY = "dg:ad-pop";

/**
 * What has already fired on this page load.
 *
 * Module scope on purpose: it survives the effect cleanup that StrictMode and
 * every route change perform, so an impression is only ever counted once.
 *
 *   social bar → once per page load (it is a bar that stays on screen)
 *   pop-under  → once per *route*, so the owner's per-session cap is reachable;
 *                the cap and the cool-down still decide whether it actually
 *                opens. Firing once per load made a cap of four meaningless.
 */
const fired = new Set<string>();

/** The key an impression is counted under. */
function impressionKey(format: "popunder" | "socialBar", pathname: string): string {
  return format === "popunder" ? `popunder:${pathname}` : "socialBar";
}

/**
 * Which route has an advert on it (the in-page banner counting the house
 * creative)?
 *
 * A pop-under that opens *behind a page with no advert on it* is the worst
 * trade the site can make: the visitor gets the interruption, the page gets
 * nothing. The pop-under therefore waits until an advert is visible on **this**
 * route, which is also what the better networks expect when they audit
 * placements.
 *
 * The route is part of the answer on purpose: a module-level boolean survives
 * every SPA navigation, so a visitor who left an advert-covered page could
 * otherwise be interrupted on a call screen that shows nothing.
 */
let onPageAdvertPath: string | null = null;

/** Called by the in-page banner as it mounts. */
export function markOnPageAdvert(path: string): void {
  onPageAdvertPath = path;
}

/** Called when a route stops rendering the banner. */
export function clearOnPageAdvert(path: string): void {
  if (onPageAdvertPath === path) onPageAdvertPath = null;
}

/** A zero-height mount point for formats that draw themselves. */
function globalHost(kind: string): HTMLElement {
  const id = `dg-ad-${kind}`;
  const existing = document.getElementById(id);
  if (existing) return existing;
  const host = document.createElement("div");
  host.id = id;
  host.setAttribute("data-dg-ad", kind);
  document.body.appendChild(host);
  return host;
}

/**
 * How many pop-unders this visitor may still get, and whether the cooldown has
 * passed.
 *
 * The cap is per *browser session* (the tab is closed and the count starts
 * again), so it is read and written only when a pop-under is actually about to
 * fire. Asking the question without consuming a slot is what lets the
 * component wait for an advert to be on the page first — the generous version
 * of this function silently burned a visitor's whole allowance on pages that
 * showed them nothing.
 */
function popunderBudget(limits: AdSettings["limits"]): {
  allowed: boolean;
  why?: string;
} {
  if (limits.popunderPerSession <= 0) {
    return { allowed: false, why: "cap is 0 per session" };
  }
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(POP_KEY);
    const state = raw ? (JSON.parse(raw) as { count?: number; at?: number }) : {};
    const count = Number(state.count) || 0;
    const at = Number(state.at) || 0;
    if (count >= limits.popunderPerSession) {
      return {
        allowed: false,
        why: `session cap reached (${count}/${limits.popunderPerSession})`,
      };
    }
    if (at && now - at < limits.popunderCooldownSeconds * 1000) {
      const left = Math.ceil(
        (limits.popunderCooldownSeconds * 1000 - (now - at)) / 1000
      );
      return { allowed: false, why: `cooldown, ${left}s left` };
    }
    window.sessionStorage.setItem(
      POP_KEY,
      JSON.stringify({ count: count + 1, at: now })
    );
    return { allowed: true };
  } catch {
    // Storage blocked (private mode, a strict browser): a pop-under is still
    // better than none, and the per-page `fired` guard stops repeats.
    return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AdSlots() {
  const { pathname } = useLocation();
  const [settings, setSettings] = useState<AdSettings | null>(null);

  const placement: AdPlacement = placementFor(pathname);
  const allowed = settings ? placementAllowed(settings, placement) : false;

  useEffect(() => {
    installAdDiagnostics();
  }, []);

  useEffect(() => {
    let alive = true;
    getAdSettings()
      .then((next) => {
        if (alive) setSettings(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Fire the self-drawing formats once, when the visitor is on a page the
  // owner allows, and never during the first paint.
  useEffect(() => {
    if (!settings) return;
    if (!allowed) {
      noteAd({
        format: "placement",
        verdict: "not-allowed-on-route",
        detail: placement,
      });
      return;
    }

    let cancelled = false;
    let idleHandle = 0;
    let waitTimer = 0;

    const fire = (
      format: "popunder" | "socialBar",
      slot: AdSlot
    ): "wait" | undefined => {
      const verdict = (v: AdVerdict, detail?: string): undefined => {
        noteAd({ format, verdict: v, detail });
        return undefined;
      };

      const key = impressionKey(format, pathname);
      if (!slot.enabled) return verdict("disabled");
      if (fired.has(key)) return verdict("already-fired");

      const code = slot.code.trim();
      if (!code) {
        // The switch is on but the box is empty. Recording the reason is all
        // this format can do: it draws itself, so there is nothing to show in
        // its place (the in-page banner covers that).
        return verdict("empty-code");
      }

      if (format === "popunder") {
        if (onPageAdvertPath !== pathname) {
          // Nothing is on the page yet: hold the interruption back and try
          // again shortly. Calling `popunderBudget` here would spend the slot.
          return "wait";
        }
        const budget = popunderBudget(settings.limits);
        if (!budget.allowed) return verdict("capped", budget.why);
      }

      fired.add(key);
      const result = mountSnippet(globalHost(format), code, 1);
      noteAd({
        format,
        verdict: "injected",
        scripts: result.scripts,
        framed: result.framed,
        detail: `${result.nodes} node(s)`,
      });
    };

    /** Returns "wait" when the pop-under is holding for an on-page advert. */
    const attempt = (): "wait" | void => {
      fire("socialBar", settings.socialBar);
      const state = fire("popunder", settings.popunder);
      if (state === "wait") return "wait";
    };

    const schedule = (delay: number) => {
      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(run, { timeout: 2000 });
      } else {
        waitTimer = window.setTimeout(run, delay);
      }
    };

    const run = () => {
      if (cancelled) return;
      if (attempt() === "wait") {
        // An advert is being drawn right now (the banner mounts on the same
        // pass), so a short second look is enough; after that the page simply
        // has no advert and the pop-under stays quietly unfired.
        waitTimer = window.setTimeout(() => {
          if (cancelled) return;
          if (attempt() === "wait") {
            noteAd({
              format: "popunder",
              verdict: "no-advert-on-page",
              detail: "held back so the page is never interrupted for nothing",
            });
          }
        }, 800);
        return;
      }
    };

    schedule(1200);

    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      window.clearTimeout(waitTimer);
    };
  }, [settings, allowed, placement]);

  // A route with no advert in the page (a call, a 404) must not keep a stale
  // "an advert is visible" flag — the pop-under would fire behind a blank page.
  useEffect(() => {
    return () => clearOnPageAdvert(pathname);
  }, [pathname]);

  return null;
}
