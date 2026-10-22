import { useState } from "react";
import { ExternalLink, Link2, Loader2 } from "lucide-react";
import { createLink } from "../../lib/admin/client";
import { CopyButton, Notice } from "./ui";

/**
 * "Open" and "Copy link" for a profile, aware of private mode.
 *
 * A bare `/dreamgirl/<slug>` URL only works while the site is public. In
 * private mode the gate answers 404 for everyone — the owner included — and the
 * only way in is a `/s/<token>` share link. The panel used to link to the bare
 * URL regardless, so every preview 404'd and looked like a broken profile.
 *
 * While private:
 *   • Preview mints a 10-minute link and opens it (the customer's view).
 *   • Copy mints an hour-long link so the URL can be handed out.
 * While public: the plain profile URL, no KV writes.
 */
export const PREVIEW_SECONDS = 10 * 60;
export const SHARE_SECONDS = 60 * 60;

export interface SharedLink {
  slug: string;
  url: string;
  copied: boolean;
  seconds: number;
  opened: boolean;
}

/** Bare profile URL — only valid while private mode is OFF. */
export function profileUrl(slug: string): string {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/dreamgirl/${encodeURIComponent(slug)}`;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

const ACTION =
  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium disabled:opacity-40";

export function ProfileLinkActions({
  slug,
  isPrivate,
  onResult,
  onError,
}: {
  slug: string;
  isPrivate: boolean;
  onResult?: (result: SharedLink) => void;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState<"open" | "copy" | null>(null);

  if (!isPrivate) {
    return (
      <>
        <CopyButton value={profileUrl(slug)} label="Copy link" />
        <a
          href={profileUrl(slug)}
          target="_blank"
          rel="noreferrer"
          className={`${ACTION} border-white/10 text-neutral-300 hover:bg-white/5`}
        >
          <ExternalLink className="w-3 h-3" /> Open
        </a>
      </>
    );
  }

  /**
   * Open the tab *before* awaiting: browsers only honour window.open while the
   * click is being handled, so a popup opened after the fetch is blocked.
   */
  const preview = async () => {
    const tab = typeof window === "undefined" ? null : window.open("", "_blank");
    setBusy("open");
    try {
      const { link } = await createLink(slug, PREVIEW_SECONDS);
      if (tab) tab.location.href = link.url;
      onResult?.({
        slug,
        url: link.url,
        copied: false,
        seconds: PREVIEW_SECONDS,
        opened: Boolean(tab),
      });
    } catch (err) {
      tab?.close();
      onError?.((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy("copy");
    try {
      const { link } = await createLink(slug, SHARE_SECONDS);
      const copied = await copyText(link.url);
      onResult?.({
        slug,
        url: link.url,
        copied,
        seconds: SHARE_SECONDS,
        opened: false,
      });
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        title="Open this profile with a 10-minute share link"
        disabled={busy !== null}
        onClick={() => void preview()}
        className={`${ACTION} border-white/10 text-neutral-300 hover:bg-white/5`}
      >
        {busy === "open" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <ExternalLink className="w-3 h-3" />
        )}
        Preview
      </button>
      <button
        type="button"
        title="Create a 1-hour share link and copy it"
        disabled={busy !== null}
        onClick={() => void share()}
        className={`${ACTION} border-white/10 text-neutral-300 hover:bg-white/5`}
      >
        {busy === "copy" ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Link2 className="w-3 h-3" />
        )}
        Copy 1h link
      </button>
    </>
  );
}

function describe(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * The created link, always shown as text — the clipboard can be blocked by the
 * browser, and then the URL would be lost otherwise.
 */
export function SharedLinkNotice({
  shared,
  onClose,
}: {
  shared: SharedLink | null;
  onClose: () => void;
}) {
  if (!shared) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-52">
        <Notice kind="success">
          {shared.opened ? "Opened" : "Created"} a {describe(shared.seconds)} link for{" "}
          <strong>/{shared.slug}</strong>
          {shared.copied
            ? " — copied to your clipboard."
            : shared.opened
              ? "."
              : " — copy it below."}
          <span className="block break-all mt-1 text-emerald-200/90">{shared.url}</span>
        </Notice>
      </div>
      <CopyButton value={shared.url} label="Copy" />
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-neutral-400 hover:bg-white/5"
      >
        Dismiss
      </button>
    </div>
  );
}
