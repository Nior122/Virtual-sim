// ---------------------------------------------------------------------------
// The call regulator endpoint.
//
//   GET  /api/call-access?profile=<slug>   → may this visitor call this profile?
//   POST /api/call-access  {"profile":…}   → yes, and count it
//
// The call screen asks before it rings and reports the call once the video is
// actually playing, so a call that never connects does not burn the client's
// allowance.
//
// The visitor is identified by an HttpOnly cookie set here on first contact.
// It holds 32 random hex characters and no personal data; the KV record behind
// it lives for the length of the window and then expires on its own.
// ---------------------------------------------------------------------------
import type { Env } from "../../src/lib/bot/types";
import {
  checkCallAccess,
  clientCookie,
  newClientId,
  readClientId,
  registerCall,
  type CallAccessResponse,
} from "../../src/lib/calls/access";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function json(
  body: CallAccessResponse | { error: string },
  status: number,
  cookie?: string
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanSlug(value: string | null | undefined): string | null {
  const slug = String(value || "").trim().toLowerCase();
  return SLUG_RE.test(slug) ? slug : null;
}

interface Context {
  request: Request;
  env: Env;
}

/** Identify (or enrol) the visitor. Returns the id and any cookie to set. */
function identify(request: Request): { clientId: string; cookie?: string } {
  const existing = readClientId(request);
  if (existing) return { clientId: existing };
  const clientId = newClientId();
  const secure = new URL(request.url).protocol === "https:";
  return { clientId, cookie: clientCookie(clientId, secure) };
}

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url);
  const slug = cleanSlug(url.searchParams.get("profile") || url.searchParams.get("slug"));
  if (!slug) return json({ error: "A profile slug is required" }, 400);

  const { clientId, cookie } = identify(request);
  const state = await checkCallAccess(env, clientId, slug);
  return json(state, 200, cookie);
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  let body: { profile?: unknown; slug?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const slug = cleanSlug(
    typeof body.profile === "string"
      ? body.profile
      : typeof body.slug === "string"
        ? body.slug
        : null
  );
  if (!slug) return json({ error: "A profile slug is required" }, 400);

  const { clientId, cookie } = identify(request);
  const state = await registerCall(env, clientId, slug);
  return json(state, 200, cookie);
}
