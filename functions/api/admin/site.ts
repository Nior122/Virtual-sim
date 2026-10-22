import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { handle, json, readJson } from "../../../src/lib/admin/http";
import { setAdUrl, setPrivateMode, siteState } from "../../../src/lib/admin/service";

/**
 * Private mode and the ad destination.
 * POST { private?: boolean, adUrl?: string | null }
 */
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => json(await siteState(env, new URL(request.url).origin)));
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
    const body = await readJson<{ private?: unknown; adUrl?: unknown }>(request);
    if (!body) return json({ error: "Missing body." }, 400);

    if (typeof body.private === "boolean") {
      await setPrivateMode(env, body.private);
    }
    if (Object.prototype.hasOwnProperty.call(body, "adUrl")) {
      const value =
        typeof body.adUrl === "string" && body.adUrl.trim()
          ? body.adUrl.trim()
          : null;
      await setAdUrl(env, value);
    }
    return json(await siteState(env, new URL(request.url).origin));
  });
}
