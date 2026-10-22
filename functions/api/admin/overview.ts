import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { handle, json } from "../../../src/lib/admin/http";
import { overview } from "../../../src/lib/admin/service";

/** Everything the dashboard needs on first paint. */
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
    const origin = new URL(request.url).origin;
    return json(await overview(env, origin));
  });
}
