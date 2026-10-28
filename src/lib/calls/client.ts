// ---------------------------------------------------------------------------
// Browser side of the call regulator.
//
// The server owns the numbers; this module only asks, and never decides on its
// own. Both calls fail soft (return null) so a hiccup in the API can never stop
// a video call — the regulator is a limit, not a single point of failure.
// ---------------------------------------------------------------------------
import type { CallAllowance } from "./limits";

export interface CallAccessState extends CallAllowance {
  profile: string;
  /** Server clock at the moment of the answer (for the countdown). */
  now: number;
  limits: {
    cooldownMs: number;
    windowMs: number;
    maxCalls: number;
    cooldownHours: number;
    windowHours: number;
  };
  /** False when the deployment has no KV and the limit is not enforced. */
  enforced: boolean;
}

async function readState(response: Response): Promise<CallAccessState | null> {
  if (!response.ok) return null;
  try {
    const data = (await response.json()) as CallAccessState;
    if (!data || typeof data.allowed !== "boolean") return null;
    return data;
  } catch {
    return null;
  }
}

/** May this visitor call this profile right now? Does not consume a call. */
export async function fetchCallAccess(
  slug: string
): Promise<CallAccessState | null> {
  if (!slug) return null;
  try {
    const response = await fetch(
      `/api/call-access?profile=${encodeURIComponent(slug)}`,
      { cache: "no-store", credentials: "same-origin" }
    );
    return await readState(response);
  } catch {
    return null;
  }
}

/** Count a call that actually connected (the video started playing). */
export async function postConnectedCall(
  slug: string
): Promise<CallAccessState | null> {
  if (!slug) return null;
  try {
    const response = await fetch("/api/call-access", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: slug }),
    });
    return await readState(response);
  } catch {
    return null;
  }
}
