// ---------------------------------------------------------------------------
// Small JSON helpers shared by every /api/admin route.
// Every admin response is private to one person, so nothing here is cacheable.
// ---------------------------------------------------------------------------

export function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

export function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: adminHeaders({ "Content-Type": "application/json; charset=utf-8", ...extra }),
  });
}

export function fail(
  message: string,
  status = 400,
  extra: Record<string, string> = {}
): Response {
  return json({ error: message }, status, extra);
}

/** Parse a JSON body; returns null instead of throwing on junk. */
export async function readJson<T = Record<string, unknown>>(
  request: Request
): Promise<T | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** True when the string looks like an http(s) URL. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Trim a value to a string, or null when it is empty. */
export function text(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Run an admin handler and turn thrown errors into JSON.
 * `AdminError` carries the status the client should show.
 */
export async function handle(
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    const message =
      status >= 500
        ? (err as Error)?.message || "Something went wrong."
        : (err as Error)?.message || "Bad request.";
    const details = (err as { details?: unknown })?.details;
    if (status >= 500) console.error("admin api error:", err);
    return json({ error: message, details }, status);
  }
}
