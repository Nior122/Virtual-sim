import { ExternalLink } from "lucide-react";
import { CopyButton } from "./ui";

/**
 * "Open" and "Copy link" for a profile.
 *
 * A profile URL works in both modes — private mode only hides the catalogue
 * (home, browse grid, sitemap), never the profiles themselves. So this is the
 * plain public URL, and no share link has to be minted just to look at a page.
 * A temporary `/s/<token>` link is for time-boxed sharing, and lives in the
 * Overview tab.
 */
export function profileUrl(slug: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/dreamgirl/${encodeURIComponent(slug)}`;
}

export function ProfileLinkActions({ slug }: { slug: string }) {
  return (
    <>
      <CopyButton value={profileUrl(slug)} label="Copy link" />
      <a
        href={profileUrl(slug)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] font-medium text-neutral-300 hover:bg-white/5"
      >
        <ExternalLink className="w-3 h-3" /> Open
      </a>
    </>
  );
}
