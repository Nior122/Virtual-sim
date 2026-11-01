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
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getAdSettings } from "../lib/ads/client";
import {
  placementAllowed,
  placementFor,
  type AdPlacement,
  type AdSettings,
  type AdSlot,
  type BannerPosition,
} from "../lib/ads/config";

const NATIVE_ID = "dg-ad-native";
const POP_KEY = "dg:ad-pop";
const DISMISS_KEY = "dg:ad-native-off";

/**
 * Module scope on purpose: it survives the effect cleanup that StrictMode and
 * every route change perform, so an impression is only ever counted once.
 */
const fired = new Set<string>();

// ---------------------------------------------------------------------------
// Injecting a pasted snippet
// ---------------------------------------------------------------------------
/** Copy a parsed node into the live document, re-creating `<script>` tags. */
function revive(node: Node, doc: Document): Node {
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "SCRIPT") {
    const original = node as HTMLScriptElement;
    const script = doc.createElement("script");
    for (const attribute of Array.from(original.attributes)) {
      script.setAttribute(attribute.name, attribute.value);
    }
    // Keep source order: an inline call must run after the library it needs.
    if (script.src && !original.hasAttribute("async")) script.async = false;
    script.text = original.textContent || "";
    return script;
  }

  const copy = doc.importNode(node, false);
  const target = copy as unknown as ParentNode;
  originalChildren(node).forEach((child) => {
    target.appendChild(revive(child, doc));
  });
  return copy;
}

function originalChildren(node: Node): Node[] {
  const list: Node[] = [];
  node.childNodes.forEach((child) => list.push(child));
  return list;
}

/** Sandboxed frame for snippets that would otherwise `document.write` the page away. */
function buildFrame(code: string, height: number): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.title = "Advertisement";
  frame.setAttribute("scrolling", "no");
  // Pop-ups and forms work (that is what a pop-under is); navigating the page
  // that hosts the frame does not.
  frame.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
  );
  frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  frame.style.cssText = `display:block;border:0;width:100%;height:${height}px;overflow:hidden;background:transparent;`;
  frame.srcdoc =
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>" +
    `</head><body>${code}</body></html>`;

  // srcdoc frames are same-origin, so the ad's real height can be measured and
  // the frame grown instead of clipping the creative.
  frame.addEventListener("load", () => {
    const measure = () => {
      try {
        const body = frame.contentDocument?.body;
        if (!body) return;
        const next = Math.max(body.scrollHeight, body.offsetHeight);
        if (next > 20 && next < 700 && Math.abs(next - height) > 8) {
          frame.style.height = `${next}px`;
        }
      } catch {
        /* the frame navigated away: keep the default height */
      }
    };
    measure();
    window.setTimeout(measure, 1500);
  });

  return frame;
}

function mountSnippet(host: HTMLElement, code: string, frameHeight: number): void {
  host.replaceChildren();
  if (/document\s*\.\s*write\s*\(/i.test(code)) {
    host.appendChild(buildFrame(code, frameHeight));
    return;
  }
  const parsed = new DOMParser().parseFromString(code, "text/html");
  originalChildren(parsed.body).forEach((node) => {
    host.appendChild(revive(node, document));
  });
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
 * The wrapper carries no frame of its own: no background, no border, no shadow,
 * no label. A banner should read as part of the page, not as a boxed-off slot,
 * and the creative the network renders supplies its own styling.
 */
function nativeStyle(position: BannerPosition): string {
  if (position === "fixed-top") {
    return "position:fixed;left:0;right:0;top:0;z-index:45;background:transparent;padding:0;box-sizing:border-box;";
  }
  if (position === "fixed-bottom") {
    return "position:fixed;left:0;right:0;bottom:0;z-index:45;background:transparent;padding:0 0 env(safe-area-inset-bottom);box-sizing:border-box;";
  }
  return "width:100%;max-width:760px;margin:18px auto 26px;padding:0 12px;box-sizing:border-box;";
}

function ensureNative(position: BannerPosition): { host: HTMLElement; slot: HTMLElement } {
  const existing = document.getElementById(NATIVE_ID);
  if (existing) {
    const slot = existing.querySelector<HTMLElement>("[data-dg-ad-slot]");
    if (slot) return { host: existing, slot };
  }

  const host = document.createElement("div");
  host.id = NATIVE_ID;
  // Screen readers still get a name; nothing visible is added to the page.
  host.setAttribute("role", "complementary");
  host.setAttribute("aria-label", "Sponsored content");
  host.style.cssText = nativeStyle(position);

  const slot = document.createElement("div");
  slot.setAttribute("data-dg-ad-slot", "native");
  slot.style.cssText = "min-height:1px;";

  host.appendChild(slot);

  // A pinned banner sits on top of the page, so it keeps one discreet escape:
  // a bare ✕ in its corner, no background or border. An inline banner covers
  // nothing and gets no chrome at all.
  if (position !== "inline") {
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u00d7";
    close.setAttribute("aria-label", "Hide sponsored content");
    close.style.cssText =
      "position:absolute;top:1px;right:3px;z-index:1;background:none;" +
      "border:0;color:inherit;opacity:.35;" +
      "font:400 13px/1 ui-sans-serif,system-ui,sans-serif;" +
      "line-height:1;cursor:pointer;padding:2px 4px;";
    close.addEventListener("click", () => {
      try {
        window.sessionStorage.setItem(DISMISS_KEY, "1");
      } catch {
        /* storage disabled: hiding is still fine for this page */
      }
      host.style.display = "none";
    });
    host.appendChild(close);
  }

  document.body.appendChild(host);
  return { host, slot };
}

function nativeDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Count this visitor's pop-under against the owner's cap before firing. */
function popunderBudget(limits: AdSettings["limits"]): boolean {
  if (limits.popunderPerSession <= 0) return false;
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(POP_KEY);
    const state = raw ? (JSON.parse(raw) as { count?: number; at?: number }) : {};
    const count = Number(state.count) || 0;
    const at = Number(state.at) || 0;
    if (count >= limits.popunderPerSession) return false;
    if (at && now - at < limits.popunderCooldownSeconds * 1000) return false;
    window.sessionStorage.setItem(
      POP_KEY,
      JSON.stringify({ count: count + 1, at: now })
    );
    return true;
  } catch {
    return true;
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
    if (!settings || !allowed) return;

    let cancelled = false;
    const start = () => {
      if (cancelled) return;

      const fire = (kind: "popunder" | "socialBar", slot: AdSlot) => {
        if (fired.has(kind) || !slot.enabled) return;
        const code = slot.code.trim();
        if (!code) return;
        if (kind === "popunder" && !popunderBudget(settings.limits)) return;
        fired.add(kind);
        mountSnippet(globalHost(kind), code, 1);
      };

      fire("popunder", settings.popunder);
      fire("socialBar", settings.socialBar);

      const banner = settings.native;
      if (
        !fired.has("native") &&
        banner.enabled &&
        banner.code.trim() &&
        !nativeDismissed()
      ) {
        fired.add("native");
        const { slot } = ensureNative(banner.position);
        mountSnippet(slot, banner.code.trim(), 110);
      }
    };

    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    );
    let handle: number;
    if (typeof idle.requestIdleCallback === "function") {
      handle = idle.requestIdleCallback(start, { timeout: 2000 });
    } else {
      handle = window.setTimeout(start, 1200);
    }

    return () => {
      cancelled = true;
      if (typeof idle.requestIdleCallback === "function") {
        idle.cancelIdleCallback?.(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, [settings, allowed]);

  // Once injected, a banner stays injected (re-injecting would count a second
  // impression). It is only hidden when the current route is not covered by the
  // owner's placement rules.
  useEffect(() => {
    const host = document.getElementById(NATIVE_ID);
    if (!host) return;
    host.style.display = allowed && !nativeDismissed() ? "" : "none";
  }, [allowed, pathname]);

  return null;
}
