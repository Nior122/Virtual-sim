import type { Env } from "../../../src/lib/bot/types";
import { requireAdmin } from "../../../src/lib/admin/auth";
import { fail, handle, json, readJson } from "../../../src/lib/admin/http";
import { testChat } from "../../../src/lib/admin/service";

/** Ask a published profile a question and see exactly what it answers. */
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
    const body = await readJson<{ slug?: string; message?: string }>(request);
    if (!body) return fail("Missing body.");
    const result = await testChat(
      env,
      String(body.slug || ""),
      String(body.message || "")
    );
    return json(result);
  });
}
