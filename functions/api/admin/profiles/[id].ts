import type { Env } from "../../../../src/lib/bot/types";
import { requireAdmin } from "../../../../src/lib/admin/auth";
import { fail, handle, json, readJson } from "../../../../src/lib/admin/http";
import {
  deleteProfile,
  getProfile,
  saveProfile,
  type SaveProfileInput,
} from "../../../../src/lib/admin/service";

/** One profile: read it, save the editor, or delete it. */
export async function onRequestGet({
  request,
  env,
  params,
}: {
  request: Request;
  env: Env;
  params: { id?: string };
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    const profile = await getProfile(env, String(params.id || ""));
    if (!profile) return fail("Profile not found.", 404);
    return json({ profile });
  });
}

export async function onRequestPatch({
  request,
  env,
  params,
}: {
  request: Request;
  env: Env;
  params: { id?: string };
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    const body = await readJson<SaveProfileInput>(request);
    if (!body) return fail("Missing body.");
    return json(
      await saveProfile(env, String(params.id || ""), body, new URL(request.url).origin)
    );
  });
}

export async function onRequestDelete({
  request,
  env,
  params,
}: {
  request: Request;
  env: Env;
  params: { id?: string };
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => {
    await deleteProfile(env, String(params.id || ""));
    return json({ ok: true });
  });
}
