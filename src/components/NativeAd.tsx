// ---------------------------------------------------------------------------
// The in-page "native" banner.
//
// It sits at the **bottom of the page, just above the footer**, and scrolls
// with the content like any other block. That is deliberate:
//
//   • a fixed bar is exactly what visitors describe as "stuck in the middle of
//     the page, and it will not scroll". A saved `position: "fixed-top"` turned
//     every page into an overlay floating over the content — visible, but not
//     part of the page, and impossible to get past on a small screen;
//   • a block placed *after* the footer is never reached at all;
//   • so: in the flow, under the content, above the footer. No fixed
//     positioning, no z-index, no scroll trap.
//
// The wrapper draws nothing of its own: no "Advertisement" label, no border,
// no frame. Pasting network code replaces the built-in creative exactly as
// before, and the built-in banner keeps the slot earning until then.
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
} from "../lib/ads/config";
import { clearOnPageAdvert, markOnPageAdvert } from "./AdSlots";

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
    // No border, background or label: the owner's standing rule for banner
    // slots. It reads as the last block of the page, not as a boxed-off ad.
    <div className="relative w-full px-1 py-2 sm:py-3">
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
 * Mount it once per page, directly above the footer. `className` is only for
 * spacing; the banner decides nothing about position itself.
 */
export default function NativeAd({ className = "" }: { className?: string }) {
  const { pathname } = useLocation();
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const [openTried, setOpenTried] = useState(false);

  useEffect(() => {
    installAdDiagnostics();
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

  const code = settings?.native.code.trim() ?? "";
  const house = settings ? usesHouseBanner(settings) : false;
  const network = !!settings && settings.native.enabled && code.length > 0;

  // An advert that is visible on this page is what the pop-under waits for.
  const visible = !!settings && allowed && (house || network);
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
    } else if (!code && !settings.house.enabled) {
      noteAd({ format: "native", verdict: "empty-code" });
    } else if (!code && !settings.click.url) {
      noteAd({ format: "native", verdict: "no-link" });
    } else if (house) {
      noteAd({ format: "native", verdict: "house-fallback" });
    }
  }, [settings, allowed, placement, code, house]);

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

  if (!settings || !allowed) return null;
  if (!house && !network) return null;

  const creative = code ? (
    <NetworkCreative code={code} height={110} />
  ) : (
    <HouseCreative house={settings.house} onOpen={openHouseLink} />
  );

  return (
    <div
      className={`w-full mt-8 mb-6 sm:mt-10 sm:mb-8 ${className}`}
      data-dg-ad="native"
      data-dg-ad-position="above-footer"
    >
      {/* Screen readers get a name; nothing visible is added to the page. */}
      <div role="complementary" aria-label="Sponsored content">
        {creative}
      </div>
    </div>
  );
}
