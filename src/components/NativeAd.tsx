// ---------------------------------------------------------------------------
// The in-page "native" banner.
//
// It used to be a `<div>` injected into `<body>` from `AdSlots`, which meant:
//
//   • as a fixed bar at `z-index:45` it sat *under* the site's sticky navbar
//     (`z-50`), so the live configuration — native on, position `fixed-top` —
//     rendered nothing a visitor could see;
//   • as an inline block it landed after the footer, where nobody scrolls;
//   • because it was injected outside React, a copy change in the admin panel
//     could not update it, and a network snippet that draws itself asynchronously
//     had no anchor in the layout.
//
// This component fixes all three: it renders *in the page flow* where a page
// places it, re-renders when the owner saves new copy, and when the code box is
// empty it draws the owner's own house banner (headline, line, button) instead
// of showing an empty slot. Any network snippet still wins: pasted code is
// mounted exactly as before, inside a plain container with no chrome.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getAdSettings } from "../lib/ads/client";
import { mountSnippet } from "../lib/ads/inject";
import {
  adVerdict,
  installAdDiagnostics,
  noteAd,
} from "../lib/ads/diag";
import {
  placementAllowed,
  placementFor,
  usesHouseBanner,
  type AdSettings,
  type BannerPosition,
} from "../lib/ads/config";
import { clearOnPageAdvert, markOnPageAdvert } from "./AdSlots";

const DISMISS_KEY = "dg:ad-native-off";

function dismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* storage disabled: hiding it for this page is still right */
  }
}

/**
 * Nothing of ours is drawn around the creative — but a *pinned* bar sits on top
 * of the page, so it keeps one discreet ✕. An inline banner covers nothing and
 * gets no chrome at all.
 */
function closeButton(onHide: () => void) {
  return (
    <button
      type="button"
      onClick={() => {
        rememberDismissed();
        onHide();
      }}
      aria-label="Hide sponsored content"
      className="absolute top-1 right-2 z-10 bg-transparent border-0 text-current opacity-35 hover:opacity-70 leading-none cursor-pointer text-[13px] p-1"
    >
      ×
    </button>
  );
}

// ---------------------------------------------------------------------------
// The fallback creative
// ---------------------------------------------------------------------------
/**
 * A banner the site draws itself, pointing at the owner's own click-through
 * link. Deliberately sober: one headline, one line, one button. It has to look
 * like a considered part of the page, because it is the only advert a visitor
 * sees until real network code is pasted in.
 *
 * Colours come from the theme tokens the rest of the site uses, so it is
 * readable in dark and in light mode without a second stylesheet.
 */
function HouseCreative({
  house,
  onOpen,
}: {
  house: AdSettings["house"];
  onOpen: () => void;
}) {
  return (
    <div className="relative w-full rounded-2xl border border-white/[0.08] bg-[#0c0e18] px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-base sm:text-lg font-bold text-white tracking-tight">
            {house.headline}
          </p>
          <p className="text-xs sm:text-sm text-neutral-400 mt-1 leading-relaxed">
            {house.body}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 px-5 py-2.5 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#e1147a] via-[#ec4899] to-[#9333ea] shadow-md shadow-pink-500/25 hover:opacity-95 active:scale-95 transition-all cursor-pointer"
        >
          {house.cta}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network creative
// ---------------------------------------------------------------------------
function NetworkCreative({ code, height }: { code: string; height: number }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"pending" | "mounted">("pending");

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    const result = mountSnippet(mount, code, height);
    setState("mounted");
    noteAd({
      format: "native",
      verdict: "injected",
      scripts: result.scripts,
      framed: result.framed,
      detail: `${result.nodes} node(s)`,
    });
    return () => {
      mount.replaceChildren();
    };
  }, [code, height]);

  return (
    <div
      ref={host}
      data-dg-ad-slot="native"
      className="w-full"
      style={{ minHeight: state === "pending" ? 1 : undefined }}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
/**
 * `variant` picks the layout the page needs:
 *   card    — a full-width block inside the page content (default)
 *   bar-top — pinned under the navbar, above the content
 *   bar-bottom — pinned to the bottom of the screen
 *
 * A page only renders *one* of them; `AdSlots` mounts no banner of its own.
 */
export default function NativeAd({
  variant = "card",
  className = "",
}: {
  variant?: "card" | "bar-top" | "bar-bottom";
  className?: string;
}) {
  const { pathname } = useLocation();
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const [hidden, setHidden] = useState(false);
  const [openTried, setOpenTried] = useState(false);

  useEffect(() => {
    installAdDiagnostics();
    setHidden(dismissed());
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

  const placement = placementFor(pathname);
  const allowed = settings ? placementAllowed(settings, placement) : false;

  // Does the owner want a pinned bar? Honour it on the page that renders the
  // banner in flow: moving the node would remount the creative.
  const pinned: BannerPosition =
    variant === "bar-top"
      ? "fixed-top"
      : variant === "bar-bottom"
        ? "fixed-bottom"
        : (settings?.native.position ?? "inline");

  const code = settings?.native.code.trim() ?? "";
  const house = settings ? usesHouseBanner(settings) : false;
  const network = !!settings && settings.native.enabled && code.length > 0;

  // An advert that is visible on this page is what the pop-under waits for.
  const visible = !!settings && allowed && !hidden && (house || network);
  useEffect(() => {
    if (!visible) return;
    markOnPageAdvert(pathname);
    return () => clearOnPageAdvert(pathname);
  }, [visible, pathname]);

  // One honest line in `__dgAds()` for the cases where nothing is rendered.
  useEffect(() => {
    if (!settings) return;
    if (adVerdict("native") === "injected") return;
    if (!settings.native.enabled) {
      noteAd({ format: "native", verdict: "disabled" });
    } else if (!allowed) {
      noteAd({
        format: "native",
        verdict: "not-allowed-on-route",
        detail: placement,
      });
    } else if (hidden) {
      noteAd({ format: "native", verdict: "dismissed" });
    } else if (!code && !settings.house.enabled) {
      noteAd({ format: "native", verdict: "empty-code" });
    } else if (!code && !settings.click.url) {
      noteAd({ format: "native", verdict: "no-link" });
    } else if (house) {
      noteAd({ format: "native", verdict: "house-fallback" });
    }
  }, [settings, allowed, placement, hidden, code, house]);

  // The house banner's button opens the same click-through the send button
  // uses, and records that the visitor responded before it opens the tab.
  const openHouseLink = () => {
    if (!settings || openTried) return;
    setOpenTried(true);
    const url = settings.click.url;
    if (!url) return;
    noteAd({
      format: "native",
      verdict: "injected",
      detail: "house banner clicked",
    });
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
    }
  };

  if (!settings || !allowed || hidden) return null;
  if (!house && !network) return null;

  const isPinned = pinned !== "inline";
  const wrapper = isPinned
    ? // `top-[4.5rem] sm:top-20` clears the sticky navbar (h-18 → 72px,
      // h-20 → 80px). The old injected bar used z-45 at top-0, i.e. *behind*
      // that navbar, which is why a fixed-top banner never appeared.
      `fixed left-0 right-0 z-40 px-3 sm:px-6 ${
        pinned === "fixed-top"
          ? "top-[4.5rem] sm:top-20"
          : "bottom-0 pb-[env(safe-area-inset-bottom)]"
      } pointer-events-none`
    : "w-full my-6 sm:my-8";

  const creative = code ? (
    <NetworkCreative code={code} height={pinned === "fixed-top" ? 90 : 100} />
  ) : (
    <HouseCreative house={settings.house} onOpen={openHouseLink} />
  );

  return (
    <div className={`${wrapper} ${className}`} data-dg-ad="native">
      <div className={isPinned ? "pointer-events-auto relative mx-auto max-w-3xl" : "relative"}>
        {/* Screen readers get a name; nothing visible is added to the page. */}
        <div role="complementary" aria-label="Sponsored content">
          {creative}
        </div>
        {isPinned && closeButton(() => setHidden(true))}
      </div>
    </div>
  );
}
