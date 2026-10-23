import { useEffect, useState } from "react";

/**
 * Site mode as seen by the browser.
 *
 * `/api/site-mode` is the only public signal that private mode is ON. The
 * server gate in `functions/_middleware.ts` is what actually protects the
 * profiles — this hook exists so the UI never shows a link that would 404
 * (the home page, the browse grid, "back to dreamgirls", the online pop-up).
 *
 * Profile pages are served in both modes, so this only controls the chrome
 * (footer, "back to dreamgirls", the online pop-up) and which route table is
 * mounted — never whether a profile can be loaded.
 *
 * The answer is cached for the tab so a client-side navigation does not
 * refetch it, and every hook shares one in-flight request.
 */
interface SiteModeState {
  isPrivate: boolean;
  ready: boolean;
}

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function loadSiteMode(): Promise<boolean> {
  if (cached !== null) return cached;
  if (!inflight) {
    inflight = fetch("/api/site-mode", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        cached = Boolean(data && (data as { private?: boolean }).private);
        return cached;
      })
      .catch(() => {
        // Fail open for the UI only: the server still enforces the gate.
        cached = false;
        return false;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useSiteMode(): SiteModeState {
  const [state, setState] = useState<SiteModeState>(() =>
    cached === null
      ? { isPrivate: false, ready: false }
      : { isPrivate: cached, ready: true }
  );

  useEffect(() => {
    if (state.ready) return;
    let alive = true;
    loadSiteMode().then((isPrivate) => {
      if (alive) setState({ isPrivate, ready: true });
    });
    return () => {
      alive = false;
    };
  }, [state.ready]);

  return state;
}

/** Convenience for components that only care about the flag. */
export function usePrivateMode(): boolean {
  return useSiteMode().isPrivate;
}
