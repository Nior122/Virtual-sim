import type { Env } from "../../../src/lib/bot/types";
import {
  adminConfigured,
  adminCookie,
  clearAdminCookie,
  createSession,
  currentAdmin,
  clearLoginFailures,
  loginAllowed,
  noteLoginFailure,
  sessionHours,
  verifyPassword,
} from "../../../src/lib/admin/auth";
import { fail, handle, json, readJson } from "../../../src/lib/admin/http";

/**
 * Login state for the web backend.
 *
 *   GET    → is a password configured, am I logged in, when does it expire
 *   POST   → exchange the password for a signed HttpOnly cookie
 *   DELETE → log out (the client also drops its copy of the cookie)
 *
 * The GET stays public on purpose: the login screen has to be able to say
 * "ADMIN_PASSWORD is not set yet" before anyone is authenticated.
 */
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return handle(async () => {
    const configured = adminConfigured(env);
    const identity = configured ? await currentAdmin(request, env) : null;
    return json({
      configured,
      authenticated: Boolean(identity),
      expiresAt: identity?.expiresAt ?? null,
      hours: sessionHours(env),
    });
  });
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return handle(async () => {
    if (!adminConfigured(env)) {
      return fail(
        "The backend is disabled. Set ADMIN_PASSWORD (at least 6 characters) in Pages → Settings → Environment variables, then redeploy.",
        503
      );
    }

    const gate = await loginAllowed(request, env);
    if (!gate.allowed) {
      return fail(
        `Too many wrong passwords. Try again in ${Math.ceil(gate.retryAfter / 60)} minute(s).`,
        429,
        { "Retry-After": String(gate.retryAfter) }
      );
    }

    const body = await readJson<{ password?: string }>(request);
    const password = String(body?.password || "");
    if (!password) return fail("Enter the password.");

    const ok = await verifyPassword(env, password);
    if (!ok) {
      await noteLoginFailure(request, env);
      return fail("Wrong password.", 401);
    }

    await clearLoginFailures(request, env);
    const session = await createSession(env);
    const secure = new URL(request.url).protocol === "https:";
    return json(
      { ok: true, expiresAt: session.expiresAt },
      200,
      { "Set-Cookie": adminCookie(session.value, session.maxAge, secure) }
    );
  });
}

export async function onRequestDelete({
  request,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  return handle(async () => {
    const secure = new URL(request.url).protocol === "https:";
    return json({ ok: true }, 200, { "Set-Cookie": clearAdminCookie(secure) });
  });
}
