import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { fail, handle, json, readJson } from "../../../src/lib/admin/http";
import {
  createShareLink,
  revokeLinks,
  siteState,
} from "../../../src/lib/admin/service";
import { parseDuration } from "../../../src/lib/access/mode";

/** Share links: list, create, revoke. */
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    const state = await siteState(env, new URL(request.url).origin);
    return json({ links: state.links, base: state.base });
  });
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    const body = await readJson<{
      slug?: string;
      seconds?: number | string;
      duration?: string;
    }>(request);
    if (!body) return fail("Missing body.");

    let seconds = Number(body.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      seconds = parseDuration(String(body.duration || "")) ?? 0;
    }
    const link = await createShareLink(
      env,
      new URL(request.url).origin,
      String(body.slug || ""),
      seconds
    );
    return json({ link }, 201);
  });
}

export async function onRequestDelete({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    const body = await readJson<{ selector?: string }>(request);
    if (!body?.selector) return fail("Say which link to revoke.");
    const removed = await revokeLinks(env, body.selector);
    return json({ removed });
  });
}
