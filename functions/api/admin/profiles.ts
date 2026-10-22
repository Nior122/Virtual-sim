import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { handle, json, readJson } from "../../../src/lib/admin/http";
import {
  createProfileRecord,
  listProfiles,
  type SaveProfileInput,
} from "../../../src/lib/admin/service";

/** List every profile, or create a new one from the editor. */
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  return handle(async () => json({ profiles: await listProfiles(env) }));
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
    const body = await readJson<SaveProfileInput>(request);
    if (!body) return json({ error: "Missing body." }, 400);
    const created = await createProfileRecord(
      env,
      body,
      new URL(request.url).origin
    );
    return json(created, 201);
  });
}
