import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { toPlaybackUrl } from "../../lib/video/playback";
import { cn } from "./ui";

/**
 * A still frame from a video URL, used in the admin profile editor so the
 * owner can tell which video a row is before deleting it.
 *
 * The frame comes from a muted, never-played <video> pointed at the same
 * proxy the call screen uses (`toPlaybackUrl`), which keeps hotlink-protected
 * CDNs happy. `loadedmetadata` gives us the real pixel size, so a portrait
 * clip gets a portrait thumbnail and a landscape clip a landscape one; the
 * box keeps the clip's own aspect ratio (clamped) instead of cropping it into
 * a square.
 *
 * Everything is lazy: the element mounts only when the row scrolls near the
 * viewport, and the URL is debounced so typing a link does not fire a request
 * per keystroke.
 */

const THUMB_HEIGHT = 84;
const THUMB_MAX_WIDTH = 150;
const MIN_RATIO = 0.5; // tallest we show (1:2)
const MAX_RATIO = 2.2; // widest we show (~21:9)
const TYPING_DELAY = 700;
const GIVE_UP_MS = 12000;

type Status = "idle" | "loading" | "ready" | "error";

/** Only start a request for something that could actually resolve. */
export function looksLoadable(value: string): boolean {
  return /^(https?:\/\/[^\s/]+|\/api\/[^\s]+|data:video\/)/i.test(value);
}

/**
 * The shape of the preview box. Portrait clips stay portrait, landscape clips
 * stay landscape, and extreme ratios are clamped so one row cannot dominate
 * the panel. Unknown sizes fall back to 16:9.
 */
export function thumbRatio(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 16 / 9;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, width / height));
}

export function VideoThumb({ url, index }: { url: string; index: number }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [stableUrl, setStableUrl] = useState(url.trim());
  const [nearViewport, setNearViewport] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [ratio, setRatio] = useState(16 / 9);

  // Typing a URL must not spawn a request per character.
  useEffect(() => {
    const next = url.trim();
    if (next === stableUrl) return;
    const timer = window.setTimeout(() => setStableUrl(next), TYPING_DELAY);
    return () => window.clearTimeout(timer);
  }, [url, stableUrl]);

  const loadable = looksLoadable(stableUrl);
  const src = loadable ? toPlaybackUrl(stableUrl) : "";

  // A new link means a new shape; forget the old measurement.
  useEffect(() => {
    setRatio(16 / 9);
    setStatus(src ? "loading" : "idle");
  }, [src]);

  // Fetch metadata only once the row is close to the viewport.
  useEffect(() => {
    if (nearViewport || !src) return;
    const node = holderRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [src, nearViewport]);

  // A CDN that never answers should not spin forever.
  useEffect(() => {
    if (status !== "loading" || !nearViewport) return;
    const timer = window.setTimeout(
      () => setStatus((current) => (current === "loading" ? "error" : current)),
      GIVE_UP_MS
    );
    return () => window.clearTimeout(timer);
  }, [status, nearViewport, src]);

  const handleMetadata = () => {
    const element = videoRef.current;
    if (!element) return;
    const { videoWidth, videoHeight } = element;
    if (videoWidth > 0 && videoHeight > 0) {
      setRatio(thumbRatio(videoWidth, videoHeight));
    }
    // Paint a frame a little way in instead of the (often black) first frame.
    try {
      const duration = element.duration;
      const target =
        Number.isFinite(duration) && duration > 0.5 ? Math.min(0.4, duration * 0.1) : 0.1;
      element.currentTime = target;
    } catch {
      setStatus("ready");
    }
  };

  const showVideo = Boolean(src) && nearViewport && status !== "error";
  const markReady = () => setStatus((current) => (current === "error" ? current : "ready"));

  return (
    <div
      ref={holderRef}
      title={stableUrl || "Paste a video link to see its preview"}
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/50"
      style={{ height: THUMB_HEIGHT, aspectRatio: `${ratio}`, maxWidth: THUMB_MAX_WIDTH }}
    >
      {showVideo && (
        // Muted and never played: this element exists only to show its first frames.
        <video
          ref={videoRef}
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          aria-hidden="true"
          className={cn(
            "h-full w-full object-cover transition-opacity duration-200",
            status === "ready" ? "opacity-100" : "opacity-0"
          )}
          onLoadedMetadata={handleMetadata}
          onLoadedData={markReady}
          onSeeked={markReady}
          onError={() => setStatus("error")}
        />
      )}

      {status !== "ready" && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-500">
          {status === "error" || !src ? (
            <Film className="h-4 w-4" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
        </span>
      )}

      {status === "error" && src && (
        <span className="absolute inset-x-0 bottom-0.5 text-center text-[8px] leading-tight text-neutral-500">
          no preview
        </span>
      )}

      <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-px text-[9px] font-semibold text-neutral-200">
        {index + 1}
      </span>
    </div>
  );
}
